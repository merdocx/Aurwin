import { beforeAll, describe, expect, it } from "vitest";
import { ensureMigratedUp, getTestPool, insertCreature } from "../../db/tests/helpers.js";
import { ReflectionWorker } from "../src/worker.js";
import { buildGroundedResponse, FakeAnthropicTransport } from "./fakeTransport.js";

/**
 * Гейт фазы 6 (ops/phases/phase-6.md, раздел 8 ТЗ): интеграционный тест на
 * 5-10 существах — полный цикл эпизод -> рефлексия -> изменение поведения.
 *
 * "Изменение поведения" здесь проверяется на уровне СОСТОЯНИЯ, которое
 * реально читает utility AI (7.7, А.4: traits/weights/intentions) — то, что
 * такие изменения СДВИГАЮТ решения, уже отдельно доказано существующими
 * тестами services/sim-engine/tests/utilityAI.test.ts (intention_bonus,
 * w_trait и т.д.) и не переописывается здесь заново: задача ЭТОГО теста —
 * доказать, что reflection-worker корректно производит и применяет именно
 * то состояние, которое эти механизмы используют. Проверка проходит через
 * реальный Postgres (не мок БД) и настоящий пайплайн queue -> anthropic
 * (транспорт подменён, т.к. в этой среде нет ANTHROPIC_API_KEY, см.
 * ops/DEVIATIONS.md, фаза 6) -> validate -> apply.
 */
describe("reflection-worker: интеграционный цикл эпизод -> рефлексия -> изменение состояния (7-8 существ, фаза 6)", () => {
  beforeAll(async () => {
    await ensureMigratedUp();
  });

  it("событийная (Sonnet, обычный вызов) и фоновая (Haiku, Batch API) рефлексии применяются к живым существам", async () => {
    const pool = getTestPool();

    // Общий эфемерный Postgres используется ВСЕМИ файлами тестов этого пакета
    // (vitest.config.ts: fileParallelism: false, без сброса между файлами) —
    // другие файлы (queue.test.ts и т.п.) намеренно оставляют "зависшие"
    // due-кандидаты (это часть ИХ проверок). Чтобы точные числа ниже
    // (applied===6, ровно 3 createMessage, ровно один batch на 3 существа)
    // не зависели от порядка запуска файлов, гарантируем чистый старт именно
    // для отбора кандидатов. Также чистим недавние event-строки: иначе
    // event_global_limit_per_hour (10) уже забит applied из queue.test.
    await pool.query(`DELETE FROM reflections WHERE status IN ('queued', 'failed', 'sent')`);
    await pool.query(
      `DELETE FROM reflections WHERE kind = 'event' AND created_at > now() - interval '25 hours'`,
    );
    await pool.query(`UPDATE episodes SET consumed_by_reflection = TRUE WHERE consumed_by_reflection = FALSE`);
    await pool.query(`UPDATE creatures SET is_asleep = FALSE WHERE is_asleep = TRUE`);

    await pool.query(
      `INSERT INTO world_clock (id, tick, phase) VALUES (1, 100000, 'day') ON CONFLICT (id) DO UPDATE SET tick = EXCLUDED.tick, phase = EXCLUDED.phase`,
    );

    const victim = await insertCreature(pool, { species: "penguin", name: "Мора" });
    await pool.query(`UPDATE creatures SET died_at_tick = 10, death_cause = 'predation' WHERE id = $1`, [victim]);

    const eventCreatures: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await insertCreature(pool, { species: "penguin", name: `Тестовый${i}` });
      eventCreatures.push(id);
      await pool.query(
        `INSERT INTO episodes (creature_id, tick, type, participants, significance) VALUES ($1, 10, 'friend_died', $2, 0.9)`,
        [id, [victim]],
      );
    }
    // Первое событийное существо дополнительно боится north_bay — проверяем, что
    // производный zone_penalty реально попадёт в intentions после применения.
    await pool.query(`UPDATE creatures SET habits = $2 WHERE id = $1`, [eventCreatures[0], JSON.stringify({ north_bay: -0.6 })]);

    const backgroundCreatures: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await insertCreature(pool, { species: i === 0 ? "orca" : "penguin", name: `Спящий${i}` });
      backgroundCreatures.push(id);
      await pool.query(`UPDATE creatures SET is_asleep = TRUE WHERE id = $1`, [id]);
      // Непустой фон: иначе skip empty background не ставит LLM в очередь.
      await pool.query(
        `INSERT INTO episodes (creature_id, tick, type, participants, significance) VALUES ($1, 10, 'woken_by_alarm', '{}', 0.2)`,
        [id],
      );
    }

    const beforeTraits = new Map<string, any>();
    for (const id of [...eventCreatures, ...backgroundCreatures]) {
      const row = await pool.query(`SELECT traits FROM creatures WHERE id = $1`, [id]);
      beforeTraits.set(id, row.rows[0].traits);
    }

    const transport = new FakeAnthropicTransport(buildGroundedResponse);
    const worker = new ReflectionWorker(pool, transport);
    const summary = await worker.runPass();

    expect(summary.applied).toBe(6);
    expect(summary.failed).toBe(0);
    expect(summary.transportErrors).toBe(0);

    // Событийная рефлексия — обычный (не batch) вызов Messages API (7.5): по одному createMessage на существо.
    expect(transport.messageCalls.length).toBe(3);
    // Фоновая — ОДИН batch-вызов на ВСЕ 3 спящих существа разом (7.5, 7.6: "не срочно, дешевле").
    expect(transport.batchCallCount).toBe(1);
    expect(transport.lastBatchItems.length).toBe(3);

    for (const id of [...eventCreatures, ...backgroundCreatures]) {
      const row = await pool.query(`SELECT traits, narrative, narrative_facts, intentions, last_reflection_at FROM creatures WHERE id = $1`, [id]);
      const after = row.rows[0];
      expect(after.narrative.length).toBeGreaterThan(0);
      expect(after.narrative_facts.length).toBeGreaterThan(0);
      expect(Number(after.last_reflection_at)).toBe(100000);
      // Черты реально сдвинулись (не остались точь-в-точь как при рождении) — цель 6 раздела 2 ТЗ.
      const before = beforeTraits.get(id);
      const changed = Object.keys(before).some((k) => Math.abs(before[k] - after.traits[k]) > 1e-9);
      expect(changed).toBe(true);
    }

    // Конкретная проверка "рефлексия -> изменение поведения": существо, боявшееся
    // north_bay, получило intention с zone_penalty на north_bay — именно ТАКОЙ
    // intention utilityAI.ts::intentionTerm вычитает из полезности захода в зону
    // (см. комментарий выше про services/sim-engine/tests/utilityAI.test.ts).
    const zoneAvoider = await pool.query(`SELECT intentions FROM creatures WHERE id = $1`, [eventCreatures[0]]);
    const intentions = zoneAvoider.rows[0].intentions as Array<{ effect: { zone_penalty?: Record<string, number> } }>;
    expect(intentions.some((i) => i.effect.zone_penalty?.north_bay !== undefined)).toBe(true);

    // Эпизоды, вошедшие в вызов, помечены consumed — не попадут в следующее слияние.
    for (const id of eventCreatures) {
      const episodes = await pool.query(`SELECT consumed_by_reflection FROM episodes WHERE creature_id = $1`, [id]);
      expect(episodes.rows.every((r) => r.consumed_by_reflection)).toBe(true);
    }

    // Все 6 строк reflections закрыты статусом 'applied'.
    const reflectionRows = await pool.query(`SELECT status FROM reflections WHERE creature_id = ANY($1::uuid[])`, [
      [...eventCreatures, ...backgroundCreatures],
    ]);
    expect(reflectionRows.rows.every((r) => r.status === "applied")).toBe(true);
  });
});
