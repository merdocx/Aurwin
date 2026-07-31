import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureMigratedUp, getTestPool, insertCreature } from "../../db/tests/helpers.js";
import { insertDecisionLogs, insertSignals, updateSignalOutcomes } from "../src/persistence/persist.js";
import { Simulation } from "../src/sim/simulation.js";

describe("signals + decision_log persistence (А.2 follow-up)", () => {
  beforeAll(async () => {
    await ensureMigratedUp();
  });

  it("drainNewSignals / drainDecisionLogs наполняются на тике с сэмплированной когортой", () => {
    const sim = new Simulation(42);
    // Несколько тиков — касатки/пингвины успевают подать сигналы или хотя бы
    // записаться в decision_log (cohort семплируется на каждом genesis).
    for (let i = 0; i < 30; i++) sim.tick();
    const decisions = sim.drainDecisionLogs();
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions[0]).toMatchObject({
      creatureId: expect.any(String),
      tick: expect.any(Number),
      chosenAction: expect.any(String),
      factors: expect.any(Array),
    });
    // Второй drain — пусто (буфер сброшен).
    expect(sim.drainDecisionLogs()).toHaveLength(0);
  });

  it("insertSignals + updateSignalOutcomes пишут и обновляют outcome в Postgres", async () => {
    const pool = getTestPool();
    const senderId = await insertCreature(pool, { species: "penguin", name: "СигналТест" });
    const signalId = randomUUID();
    await insertSignals(pool, [
      {
        id: signalId,
        senderId,
        tick: 10,
        type: "alarm_call",
        zone: "main_ice",
        trueState: 1,
        claimedState: 1,
        outcome: "pending",
        receivers: [],
        resolveByTick: 20,
      },
    ]);
    const before = await pool.query(`SELECT outcome FROM signals WHERE id = $1`, [signalId]);
    expect(before.rows[0].outcome).toBe("pending");

    await updateSignalOutcomes(pool, [
      {
        id: signalId,
        senderId,
        tick: 10,
        type: "alarm_call",
        zone: "main_ice",
        trueState: 1,
        claimedState: 1,
        outcome: "disconfirmed",
        receivers: [],
        resolveByTick: 20,
      },
    ]);
    const after = await pool.query(`SELECT outcome FROM signals WHERE id = $1`, [signalId]);
    expect(after.rows[0].outcome).toBe("disconfirmed");
  });

  it("insertDecisionLogs пишет строку в decision_log", async () => {
    const pool = getTestPool();
    const creatureId = await insertCreature(pool, { species: "penguin" });
    await insertDecisionLogs(pool, [
      {
        creatureId,
        tick: 5,
        chosenAction: "eat",
        factors: [{ action: "eat", utility: 0.8, breakdown: { need: 0.5 } }],
      },
    ]);
    const rows = await pool.query(`SELECT chosen_action, factors FROM decision_log WHERE creature_id = $1`, [creatureId]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].chosen_action).toBe("eat");
  });
});
