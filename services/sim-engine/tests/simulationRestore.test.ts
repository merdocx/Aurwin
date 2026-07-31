import { describe, expect, it } from "vitest";
import { Simulation } from "../src/sim/simulation.js";
import { bondKey, aversionKey, type AversionRecord, type BondRecord } from "../src/sim/types.js";
import { makeTestCreature } from "./testCreature.js";

/**
 * Восстановление мира после рестарта (А.7, фаза 7): Simulation, получивший
 * `restore`, НЕ должен запускать genesis, а должен продолжить с переданного
 * тика/популяции/связей — это то же самое требование, что и в
 * persistence/restore.ts, но проверяемое без БД (restore-объект собран вручную).
 */
describe("Simulation: восстановление из снапшота (А.7)", () => {
  it("без restore — обычный genesis-запуск", () => {
    const sim = new Simulation(1);
    expect(sim.currentTick).toBe(0);
    expect(sim.aliveCreatures().length).toBeGreaterThan(0);
  });

  it("с restore — популяция и тик берутся из restore, а не из genesis", () => {
    const restoredCreature = makeTestCreature({ id: "r1", species: "penguin" });
    const bond: BondRecord = { creatureA: "r1", creatureB: "r2", kind: "friend", strength: 0.5 };
    const aversion: AversionRecord = { subjectId: "r1", objectId: "r3", strength: 0.4 };

    const sim = new Simulation(1, {}, { tick: 12345, creatures: [restoredCreature], bonds: [bond], aversions: [aversion] });

    expect(sim.currentTick).toBe(12345);
    expect(sim.aliveCreatures()).toHaveLength(1);
    expect(sim.aliveCreatures()[0].id).toBe("r1");
    expect(sim.bonds.get(bondKey("r1", "r2"))).toEqual(bond);
    expect(sim.aversions.get(aversionKey("r1", "r3"))).toEqual(aversion);
  });

  it("восстановленный tick переносится и на суточный цикл мира (day/night не сбрасывается на тик 0)", () => {
    const ticksPerDay = new Simulation(1).world.dayNight.ticksPerDay();
    const nightTick = Math.floor(ticksPerDay * 0.75);
    const sim = new Simulation(1, {}, { tick: nightTick, creatures: [], bonds: [], aversions: [] });
    expect(sim.world.dayNight.currentTick).toBe(nightTick);
  });

  it("после restore тик продолжает идти вперёд обычным tick(), а не догоняет пропущенное время", () => {
    const sim = new Simulation(1, {}, { tick: 500, creatures: [makeTestCreature({ id: "r1" })], bonds: [], aversions: [] });
    sim.tick();
    expect(sim.currentTick).toBe(501);
  });
});
