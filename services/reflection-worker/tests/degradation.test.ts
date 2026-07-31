import { beforeAll, describe, expect, it } from "vitest";
import { ensureMigratedUp, getTestPool, insertCreature } from "../../db/tests/helpers.js";
import { ReflectionWorker } from "../src/worker.js";
import { buildGroundedResponse, FakeAnthropicTransport } from "./fakeTransport.js";

/**
 * Гейт фазы 6: деградация при недоступном API (ТЗ 7.3, раздел 8: "LLM API
 * недоступен 6 часов подряд ... симуляция не останавливалась ... очередь
 * рефлексий разобралась без дублирующего навёрстывания"). reflection-worker
 * — отдельный процесс от sim-engine (А.1): здесь проверяется его половина
 * контракта — очередь копится, ничего не теряется и не роняет процесс, а
 * после восстановления API разбирается без применения "задним числом" по
 * нескольку раз за одно и то же существо.
 */
describe("reflection-worker: деградация при недоступном Anthropic API (7.3)", () => {
  beforeAll(async () => {
    await ensureMigratedUp();
  });

  it("API недоступен: очередь копится (reflections остаются 'queued'), runPass не падает, существа не теряются", async () => {
    const pool = getTestPool();
    await pool.query(`INSERT INTO world_clock (id, tick, phase) VALUES (1, 10, 'day') ON CONFLICT (id) DO UPDATE SET tick = EXCLUDED.tick`);

    const creatureId = await insertCreature(pool, { species: "penguin", name: "Деградация1" });
    await pool.query(`INSERT INTO episodes (creature_id, tick, type, participants, significance) VALUES ($1, 10, 'birth', '{}', 0.6)`, [creatureId]);

    const transport = new FakeAnthropicTransport(buildGroundedResponse);
    transport.down = true;
    const worker = new ReflectionWorker(pool, transport);

    const result = await worker.runPass();
    expect(result.transportErrors).toBeGreaterThan(0);
    expect(result.applied).toBe(0);

    const row = await pool.query(`SELECT status FROM reflections WHERE creature_id = $1`, [creatureId]);
    expect(row.rowCount).toBeGreaterThan(0);
    expect(row.rows.every((r) => r.status === "queued")).toBe(true);

    // Существо продолжает "жить" со старыми намерениями/narrative — apply.ts не тронул creatures.
    const creature = await pool.query(`SELECT narrative, last_reflection_at FROM creatures WHERE id = $1`, [creatureId]);
    expect(creature.rows[0].narrative).toBeNull();
  });

  it("после восстановления API очередь разбирается РОВНО один раз на существо — без дублирующего применения", async () => {
    const pool = getTestPool();
    await pool.query(`INSERT INTO world_clock (id, tick, phase) VALUES (1, 20, 'day') ON CONFLICT (id) DO UPDATE SET tick = EXCLUDED.tick`);

    const creatureId = await insertCreature(pool, { species: "penguin", name: "Деградация2" });
    await pool.query(`INSERT INTO episodes (creature_id, tick, type, participants, significance) VALUES ($1, 20, 'birth', '{}', 0.6)`, [creatureId]);

    const transport = new FakeAnthropicTransport(buildGroundedResponse);
    transport.down = true;
    let fakeNow = 0;
    const worker = new ReflectionWorker(pool, transport, () => fakeNow);

    // Несколько неудачных проходов подряд, разнесённых на часы (как при
    // многочасовой недоступности API, 8-й раздел ТЗ: "LLM API недоступен
    // 6 часов подряд") — время двигаем вперёд, чтобы бэкофф каждый раз
    // реально пропускал новую попытку, а не блокировал её искусственно.
    for (let hour = 0; hour < 6; hour++) {
      fakeNow = hour * 3_600_000;
      await worker.runPass();
    }

    const queuedBefore = await pool.query(`SELECT count(*)::int AS n FROM reflections WHERE creature_id = $1`, [creatureId]);
    // Кандидат уже "занят" единственной строкой reflections (см. queue.ts) — многочасовой сбой НЕ породил несколько отдельных очередей на одно и то же существо.
    expect(queuedBefore.rows[0].n).toBe(1);

    // API "восстановился" — и время продвинуто за пределы текущего окна бэкоффа.
    // (summary.applied может включать кандидатов из ДРУГИХ it()-блоков этого
    // файла, оставшихся 'queued' в общем эфемерном Postgres — поэтому ниже
    // проверяем статус ИМЕННО нашего существа, а не глобальную сводку прохода.)
    transport.down = false;
    fakeNow = 7 * 3_600_000;
    await worker.runPass();

    const finalReflections = await pool.query(`SELECT status FROM reflections WHERE creature_id = $1`, [creatureId]);
    expect(finalReflections.rowCount).toBe(1);
    expect(finalReflections.rows[0].status).toBe("applied");

    const creature = await pool.query(`SELECT narrative, last_reflection_at FROM creatures WHERE id = $1`, [creatureId]);
    expect(creature.rows[0].narrative).not.toBeNull();
    expect(Number(creature.rows[0].last_reflection_at)).toBe(20);
  });

  it("бэкофф между попытками растёт (экспоненциально), не бьёт по API сразу же после первого сбоя", async () => {
    const pool = getTestPool();
    const creatureId = await insertCreature(pool, { species: "penguin", name: "Бэкофф" });
    await pool.query(`INSERT INTO episodes (creature_id, tick, type, participants, significance) VALUES ($1, 1, 'birth', '{}', 0.6)`, [creatureId]);

    const transport = new FakeAnthropicTransport(buildGroundedResponse);
    transport.down = true;
    let fakeNow = 0;
    const worker = new ReflectionWorker(pool, transport, () => fakeNow);

    await worker.runPass();
    const reflectionRow = await pool.query(`SELECT id FROM reflections WHERE creature_id = $1`, [creatureId]);
    const reflectionId = reflectionRow.rows[0].id;
    expect(worker.backoffAttemptsFor(reflectionId)).toBe(1);

    // Сразу повторный проход (время не продвинулось) — попытка НЕ должна повториться немедленно (иначе бэкофф бессмысленен).
    const callsBefore = transport.messageCalls.length;
    await worker.runPass();
    expect(transport.messageCalls.length).toBe(callsBefore); // не был вызван снова — ещё в пределах backoff-задержки

    // Продвигаем время далеко вперёд — теперь попытка должна повториться.
    fakeNow += 60 * 60_000;
    await worker.runPass();
    expect(transport.messageCalls.length).toBeGreaterThan(callsBefore);
    expect(worker.backoffAttemptsFor(reflectionId)).toBe(2);
  });
});
