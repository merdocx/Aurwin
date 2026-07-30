import { beforeAll, describe, expect, it } from "vitest";
import { ensureMigratedUp, getTestPool, insertCreature } from "./helpers.js";
import { pruneEpisodes } from "../src/maintenance/pruneEpisodes.js";
import { cleanupDecisionLog } from "../src/maintenance/cleanupDecisionLog.js";
import { redactReflections } from "../src/maintenance/redactReflections.js";
import { thinTraitHistory } from "../src/maintenance/thinTraitHistory.js";
import { rollupWorldEvents } from "../src/maintenance/rollupWorldEvents.js";
import { rollupSignals } from "../src/maintenance/rollupSignals.js";
import { cleanupOnDeath } from "../src/maintenance/cleanupOnDeath.js";

describe("скрипты обслуживания (политика ретенции, А.2)", () => {
  beforeAll(async () => {
    await ensureMigratedUp();
  });

  it("pruneEpisodes: обрезает эпизоды сверх лимита вида, начиная с consumed_by_reflection и наименьшей significance, не трогая core_memory", async () => {
    const pool = getTestPool();
    const creature = await insertCreature(pool, { species: "penguin" });

    // Лимит пингвина — memory.episodic_limit.penguin = 50. Вставим 52 обычных
    // эпизода (потребляемых, разной significance) + 1 core_memory.
    for (let i = 0; i < 52; i += 1) {
      await pool.query(
        `INSERT INTO episodes (creature_id, tick, type, significance, consumed_by_reflection, core_memory)
         VALUES ($1, $2, 'hunt_success', $3, TRUE, FALSE)`,
        [creature, i, 0.1 + (i % 10) * 0.01],
      );
    }
    await pool.query(
      `INSERT INTO episodes (creature_id, tick, type, significance, consumed_by_reflection, core_memory)
       VALUES ($1, 999, 'friend_died', 0.95, TRUE, TRUE)`,
      [creature],
    );

    const before = await pool.query(`SELECT count(*) FROM episodes WHERE creature_id = $1`, [creature]);
    expect(Number(before.rows[0].count)).toBe(53);

    await pruneEpisodes(pool);

    const after = await pool.query(`SELECT count(*) FROM episodes WHERE creature_id = $1`, [creature]);
    // core_memory (53-й эпизод) исключён из подсчёта лимита в WHERE core_memory = FALSE,
    // поэтому обрезаются только 52 обычных эпизода до 50 + core_memory остаётся = 51.
    expect(Number(after.rows[0].count)).toBe(51);

    const coreMemoryStillThere = await pool.query(
      `SELECT 1 FROM episodes WHERE creature_id = $1 AND core_memory = TRUE`,
      [creature],
    );
    expect(coreMemoryStillThere.rowCount).toBe(1);
  });

  it("pruneEpisodes: удаляет эпизоды существа через N суток после его смерти", async () => {
    const pool = getTestPool();
    const creature = await insertCreature(pool, { species: "orca", diedAtTick: 100, diedAtDaysAgo: 40 });

    await pool.query(
      `INSERT INTO episodes (creature_id, tick, type, significance) VALUES ($1, 1, 'hunt_success', 0.5)`,
      [creature],
    );

    await pruneEpisodes(pool);

    const remaining = await pool.query(`SELECT count(*) FROM episodes WHERE creature_id = $1`, [creature]);
    expect(Number(remaining.rows[0].count)).toBe(0);
  });

  it("cleanupDecisionLog: удаляет записи старше decision_log.ttl_days", async () => {
    const pool = getTestPool();
    const creature = await insertCreature(pool);

    await pool.query(
      `INSERT INTO decision_log (creature_id, tick, chosen_action, factors, created_at)
       VALUES ($1, 1, 'idle', '{}', now() - interval '10 days')`,
      [creature],
    );
    await pool.query(
      `INSERT INTO decision_log (creature_id, tick, chosen_action, factors, created_at)
       VALUES ($1, 2, 'idle', '{}', now())`,
      [creature],
    );

    await cleanupDecisionLog(pool);

    const remaining = await pool.query(
      `SELECT chosen_action FROM decision_log WHERE creature_id = $1`,
      [creature],
    );
    expect(remaining.rows).toHaveLength(1);
  });

  it("redactReflections: обнуляет request/response старше retention.reflections_audit_days, метаданные остаются", async () => {
    const pool = getTestPool();
    const creature = await insertCreature(pool);

    const old = await pool.query(
      `INSERT INTO reflections (creature_id, kind, status, request, response, created_at)
       VALUES ($1, 'event', 'applied', '{"a":1}', '{"b":2}', now() - interval '40 days')
       RETURNING id`,
      [creature],
    );
    const recent = await pool.query(
      `INSERT INTO reflections (creature_id, kind, status, request, response, created_at)
       VALUES ($1, 'event', 'applied', '{"a":1}', '{"b":2}', now())
       RETURNING id`,
      [creature],
    );

    await redactReflections(pool);

    const oldRow = await pool.query(`SELECT request, response, status FROM reflections WHERE id = $1`, [
      old.rows[0].id,
    ]);
    expect(oldRow.rows[0].request).toBeNull();
    expect(oldRow.rows[0].response).toBeNull();
    expect(oldRow.rows[0].status).toBe("applied");

    const recentRow = await pool.query(`SELECT request FROM reflections WHERE id = $1`, [recent.rows[0].id]);
    expect(recentRow.rows[0].request).not.toBeNull();
  });

  it("thinTraitHistory: после смерти существа оставляет birth + первую/последнюю + не чаще 1/сутки", async () => {
    const pool = getTestPool();
    const ticksPerDay = 86400 / 2; // time.visual_tick_seconds = 2
    const creature = await insertCreature(pool, { diedAtTick: 5000, diedAtDaysAgo: 1 });

    await pool.query(
      `INSERT INTO trait_history (creature_id, tick, traits, source) VALUES ($1, 0, '{}', 'birth')`,
      [creature],
    );
    // Несколько записей внутри одних тех же суток жизни — должна выжить одна.
    for (let i = 1; i <= 5; i += 1) {
      await pool.query(
        `INSERT INTO trait_history (creature_id, tick, traits, source) VALUES ($1, $2, '{}', 'reflection')`,
        [creature, 10 + i],
      );
    }
    // Запись в других сутках — должна выжить отдельно (плюс это последняя запись).
    const lastTick = ticksPerDay * 3 + 50;
    await pool.query(
      `INSERT INTO trait_history (creature_id, tick, traits, source) VALUES ($1, $2, '{}', 'reflection')`,
      [creature, lastTick],
    );

    await thinTraitHistory(pool);

    const rows = await pool.query(
      `SELECT tick, source FROM trait_history WHERE creature_id = $1 ORDER BY tick`,
      [creature],
    );
    // birth (tick 0) + одна запись из первых суток + последняя запись (другие сутки)
    expect(rows.rows.length).toBe(3);
    expect(rows.rows[0].source).toBe("birth");
    expect(rows.rows[rows.rows.length - 1].tick).toBe(String(lastTick));
  });

  it("rollupWorldEvents: сворачивает события старше retention.world_events_full_days в суточные агрегаты", async () => {
    const pool = getTestPool();
    const creature = await insertCreature(pool);

    for (let i = 0; i < 3; i += 1) {
      await pool.query(
        `INSERT INTO world_events (tick, type, actor_id, created_at)
         VALUES ($1, 'birth', $2, now() - interval '100 days')`,
        [i, creature],
      );
    }
    await pool.query(
      `INSERT INTO world_events (tick, type, actor_id, created_at) VALUES (999, 'birth', $1, now())`,
      [creature],
    );

    await rollupWorldEvents(pool);

    const remainingOld = await pool.query(
      `SELECT count(*) FROM world_events WHERE created_at < now() - interval '90 days'`,
    );
    expect(Number(remainingOld.rows[0].count)).toBe(0);

    const agg = await pool.query(
      `SELECT count FROM world_events_daily_agg WHERE type = 'birth' AND day = (now() - interval '100 days')::date`,
    );
    expect(Number(agg.rows[0].count)).toBeGreaterThanOrEqual(3);
  });

  it("rollupSignals: сворачивает сигналы старше retention.signals_full_days в агрегаты по видам", async () => {
    const pool = getTestPool();
    const sender = await insertCreature(pool, { species: "penguin" });

    await pool.query(
      `INSERT INTO signals (sender_id, tick, type, true_state, claimed_state, outcome, created_at)
       VALUES ($1, 1, 'alarm_call', 0.2, 0.9, 'disconfirmed', now() - interval '40 days')`,
      [sender],
    );
    await pool.query(
      `INSERT INTO signals (sender_id, tick, type, true_state, claimed_state, outcome, created_at)
       VALUES ($1, 2, 'alarm_call', 0.8, 0.8, 'confirmed', now() - interval '40 days')`,
      [sender],
    );

    await rollupSignals(pool);

    const remaining = await pool.query(`SELECT count(*) FROM signals WHERE sender_id = $1`, [sender]);
    expect(Number(remaining.rows[0].count)).toBe(0);

    const agg = await pool.query(
      `SELECT total, disconfirmed FROM signals_daily_agg WHERE species = 'penguin' AND type = 'alarm_call' AND day = (now() - interval '40 days')::date`,
    );
    expect(Number(agg.rows[0].total)).toBeGreaterThanOrEqual(2);
    expect(Number(agg.rows[0].disconfirmed)).toBeGreaterThanOrEqual(1);
  });

  it("cleanupOnDeath: удаляет perceived_states/perceived_zone_threat/signal_trust при смерти любой из сторон", async () => {
    const pool = getTestPool();
    const alive = await insertCreature(pool, { name: "Живой" });
    const dead = await insertCreature(pool, { name: "Мёртвый", diedAtTick: 1, diedAtDaysAgo: 1 });

    await pool.query(
      `INSERT INTO perceived_states (observer_id, subject_id, perceived_vigor, perceived_threat)
       VALUES ($1, $2, 0.5, 0.5)`,
      [alive, dead],
    );
    await pool.query(
      `INSERT INTO perceived_zone_threat (observer_id, zone, threat) VALUES ($1, 'north_bay', 0.5)`,
      [dead],
    );
    await pool.query(
      `INSERT INTO signal_trust (observer_id, signaler_id, trust) VALUES ($1, $2, 0.6)`,
      [alive, dead],
    );

    await cleanupOnDeath(pool);

    expect((await pool.query(`SELECT 1 FROM perceived_states WHERE observer_id = $1`, [alive])).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM perceived_zone_threat WHERE observer_id = $1`, [dead])).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM signal_trust WHERE observer_id = $1`, [alive])).rowCount).toBe(0);
  });
});
