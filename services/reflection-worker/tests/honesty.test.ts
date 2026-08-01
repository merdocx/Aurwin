import { beforeAll, describe, expect, it } from "vitest";
import { ensureMigratedUp, getTestPool, insertCreature } from "../../db/tests/helpers.js";
import { findUngroundedNames, validateReflectionResponse } from "../src/validate.js";
import { ReflectionWorker } from "../src/worker.js";
import { buildGroundedResponse, FakeAnthropicTransport } from "./fakeTransport.js";

/**
 * Гейт фазы 6 (7.8.6, А.5, раздел 8 ТЗ): "мы сверяем narrative_facts существ
 * с журналами signals/episodes/world_events — ни один факт в карточках не
 * описывает событие, отсутствующее в журналах".
 *
 * Два уровня проверки:
 *  1) unit — findUngroundedNames() ловит имена, не встречающиеся во входных
 *     данных (см. также tests/validate.test.ts для базовых случаев);
 *  2) сквозная — прогоняем РЕАЛЬНЫЙ пайплайн (queue -> anthropic(fake) ->
 *     validate -> apply) с фейковым транспортом, который ИНОГДА выдаёт
 *     выдуманное имя, и убеждаемся, что такой ответ не проходит валидацию
 *     и не попадает в creatures.narrative_facts, а честный — проходит и
 *     каждый его факт сверяется с реальным журналом episodes этого существа.
 */
describe("reflection-worker: честность повествования (7.8.6) — narrative_facts против журналов", () => {
  beforeAll(async () => {
    await ensureMigratedUp();
  });

  /** См. integration.test.ts — общий эфемерный Postgres на весь пакет тестов, чистим "зависшие" due-кандидаты других файлов перед точными числовыми проверками. */
  async function resetDanglingCandidates(pool: ReturnType<typeof getTestPool>): Promise<void> {
    await pool.query(`DELETE FROM reflections WHERE status IN ('queued', 'failed')`);
    await pool.query(`UPDATE episodes SET consumed_by_reflection = TRUE WHERE consumed_by_reflection = FALSE`);
    await pool.query(`UPDATE creatures SET is_asleep = FALSE WHERE is_asleep = TRUE`);
  }

  it("выдуманное имя, отсутствующее в episodes/bonds/signals, проваливает валидацию (не применяется)", async () => {
    const pool = getTestPool();
    await resetDanglingCandidates(pool);
    await pool.query(`INSERT INTO world_clock (id, tick, phase) VALUES (1, 100000, 'day') ON CONFLICT (id) DO UPDATE SET tick = EXCLUDED.tick`);

    const creatureId = await insertCreature(pool, { species: "penguin", name: "Честность1" });
    await pool.query(`INSERT INTO episodes (creature_id, tick, type, participants, significance) VALUES ($1, 30, 'birth', '{}', 0.6)`, [creatureId]);

    const fabricator = (userContent: string) => {
      const payload = JSON.parse(userContent);
      return JSON.stringify({
        narrative: `Я ${payload.creature.name}. Я спас Никиту от касатки, хотя этого не было ни в одном журнале.`,
        narrative_facts: ["Спас Никиту от касатки"],
        trait_deltas: {},
        weight_deltas: {},
        intentions: [{ text: "жить как раньше", effect: {} }],
      });
    };

    const transport = new FakeAnthropicTransport(fabricator);
    const worker = new ReflectionWorker(pool, transport);
    const summary = await worker.runPass();

    // 1 ретрай — тот же фабрикатор снова придумывает то же самое имя, поэтому
    // после ретрая результат так и остаётся невалидным -> discard (7.3/А.5).
    expect(summary.failed).toBe(1);
    expect(summary.applied).toBe(0);
    expect(transport.messageCalls.length).toBe(2); // исходная попытка + 1 ретрай

    const creature = await pool.query(`SELECT narrative, narrative_facts FROM creatures WHERE id = $1`, [creatureId]);
    expect(creature.rows[0].narrative).toBeNull();
    expect(creature.rows[0].narrative_facts).toEqual([]);
  });

  it("честный ответ (факты только из episodes) проходит и совпадает с реальным журналом", async () => {
    const pool = getTestPool();
    await resetDanglingCandidates(pool);
    await pool.query(`INSERT INTO world_clock (id, tick, phase) VALUES (1, 100000, 'day') ON CONFLICT (id) DO UPDATE SET tick = EXCLUDED.tick`);

    const victim = await insertCreature(pool, { species: "penguin", name: "Погибшая" });
    await pool.query(`UPDATE creatures SET died_at_tick = 39, death_cause = 'predation' WHERE id = $1`, [victim]);

    const creatureId = await insertCreature(pool, { species: "penguin", name: "Честность2" });
    await pool.query(
      `INSERT INTO episodes (creature_id, tick, type, participants, significance) VALUES ($1, 40, 'friend_died', $2, 0.9)`,
      [creatureId, [victim]],
    );

    const transport = new FakeAnthropicTransport(buildGroundedResponse);
    const worker = new ReflectionWorker(pool, transport);
    const summary = await worker.runPass();
    expect(summary.applied).toBe(1);

    const creature = await pool.query(`SELECT narrative_facts FROM creatures WHERE id = $1`, [creatureId]);
    const facts: string[] = creature.rows[0].narrative_facts;
    expect(facts.length).toBeGreaterThan(0);

    // Сверка с журналом: реальные участники известных episodes этого существа.
    const episodeRows = await pool.query(`SELECT participants FROM episodes WHERE creature_id = $1`, [creatureId]);
    const loggedParticipantIds = new Set<string>(episodeRows.rows.flatMap((r) => r.participants as string[]));
    const namesResult = await pool.query(`SELECT name FROM creatures WHERE id = ANY($1::uuid[])`, [[...loggedParticipantIds]]);
    const loggedNames = new Set(namesResult.rows.map((r) => r.name as string));

    for (const fact of facts) {
      const ungrounded = findUngroundedNames(fact, loggedNames);
      expect(ungrounded).toHaveLength(0);
    }
  });

  it("validateReflectionResponse отклоняет ответ целиком, если хотя бы один факт не сверяется с журналом", () => {
    const raw = JSON.stringify({
      narrative: "Всё как обычно, Пин рядом.",
      narrative_facts: ["Провёл день с Пин", "Спас Тимофея от голода"],
      trait_deltas: {},
      weight_deltas: {},
      intentions: [],
    });
    const result = validateReflectionResponse(raw, { knownZones: new Set(), nameToId: new Map([["Пин", "id-1"]]) });
    expect(result.ok).toBe(false);
  });
});
