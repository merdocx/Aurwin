import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensureMigratedUp, getTestPool, insertCreature } from "../../db/tests/helpers.js";
import { recordLlmCall, register, syncReflectionHealthMetrics } from "../src/metrics.js";

/**
 * Реальных вызовов Anthropic API в этом процессе пока нет (фаза 6 не
 * реализована — см. ops/DEVIATIONS.md, фаза 7). Тест проверяет саму
 * инфраструктуру метрик — recordLlmCall() — контракт, которым будущая
 * реализация фазы 6 обязана воспользоваться, чтобы алёрты А.7 (доля ошибок
 * LLM > 50%/час, расход > 2х плана) заработали на реальных данных.
 */
describe("reflection-worker metrics: аккаунтинг вызовов LLM (6.1, А.7)", () => {
  beforeAll(async () => {
    await ensureMigratedUp();
  });

  beforeEach(() => {
    register.resetMetrics();
  });

  it("recordLlmCall инкрементирует счётчик вызовов по типу/модели/исходу", async () => {
    recordLlmCall({ type: "background", model: "claude-haiku-4-5", status: "ok", latencySeconds: 1.2, costUsd: 0.001 });
    recordLlmCall({ type: "event", model: "claude-sonnet-5", status: "error", latencySeconds: 3.4, costUsd: 0 });

    const calls = await register.getSingleMetric("aurwin_llm_calls_total")?.get();
    const ok = calls?.values.find((v) => v.labels.type === "background" && v.labels.status === "ok");
    const errored = calls?.values.find((v) => v.labels.type === "event" && v.labels.status === "error");
    expect(ok?.value).toBe(1);
    expect(errored?.value).toBe(1);
  });

  it("recordLlmCall накапливает стоимость и латентность", async () => {
    recordLlmCall({ type: "background", model: "claude-haiku-4-5", status: "ok", latencySeconds: 1, costUsd: 0.002 });
    recordLlmCall({ type: "background", model: "claude-haiku-4-5", status: "ok", latencySeconds: 1, costUsd: 0.003 });

    const cost = await register.getSingleMetric("aurwin_llm_cost_usd_total")?.get();
    const entry = cost?.values.find((v) => v.labels.type === "background" && v.labels.model === "claude-haiku-4-5");
    expect(entry?.value).toBeCloseTo(0.005, 6);
  });

  it("syncReflectionHealthMetrics публикует очередь по статусам и staleness по видам", async () => {
    const pool = getTestPool();
    await pool.query(`DELETE FROM reflections`);
    await pool.query(`DELETE FROM episodes`);
    await pool.query(`DELETE FROM bonds`);
    await pool.query(`DELETE FROM aversions`);
    await pool.query(`DELETE FROM signals`);
    await pool.query(`DELETE FROM trait_history`);
    await pool.query(`DELETE FROM learning_events`);
    await pool.query(`DELETE FROM world_events`);
    await pool.query(`DELETE FROM decision_log`);
    await pool.query(`DELETE FROM creatures`);
    await pool.query(`DELETE FROM world_clock`);
    await pool.query(`INSERT INTO world_clock (id, tick, phase) VALUES (1, 100000, 'day') ON CONFLICT (id) DO UPDATE SET tick = EXCLUDED.tick`);
    const penguin = await insertCreature(pool, { species: "penguin", name: "МетрикаП" });
    const orca = await insertCreature(pool, { species: "orca", name: "МетрикаК" });
    await pool.query(`UPDATE creatures SET last_reflection_at = 90000 WHERE id = $1`, [penguin]);
    await pool.query(`UPDATE creatures SET last_reflection_at = 95000 WHERE id = $1`, [orca]);
    await pool.query(`INSERT INTO reflections (creature_id, kind, status) VALUES ($1, 'event', 'queued')`, [penguin]);
    await pool.query(`INSERT INTO reflections (creature_id, kind, status) VALUES ($1, 'background', 'failed')`, [orca]);

    await syncReflectionHealthMetrics(pool);

    const queue = await register.getSingleMetric("aurwin_reflection_queue_by_status")?.get();
    const queued = queue?.values.find((v) => v.labels.status === "queued");
    const failed = queue?.values.find((v) => v.labels.status === "failed");
    expect(queued?.value).toBeGreaterThanOrEqual(1);
    expect(failed?.value).toBeGreaterThanOrEqual(1);

    const staleness = await register.getSingleMetric("aurwin_reflection_staleness_hours")?.get();
    const penguinAvg = staleness?.values.find((v) => v.labels.species === "penguin" && v.labels.kind === "avg");
    const orcaMax = staleness?.values.find((v) => v.labels.species === "orca" && v.labels.kind === "max");
    expect(penguinAvg?.value).toBeGreaterThan(0);
    expect(orcaMax?.value).toBeGreaterThan(0);
  });
});
