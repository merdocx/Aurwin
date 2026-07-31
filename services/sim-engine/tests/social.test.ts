import { describe, expect, it } from "vitest";
import { decayAversions, decayUntouchedBonds, growBondForPair, recordAversion } from "../src/sim/social.js";
import { getSimConstants } from "../src/sim/simConstants.js";
import { bondKey, type BondRecord, type AversionRecord } from "../src/sim/types.js";
import { makeTestCreature } from "./testCreature.js";

describe("social: связи (bonds)", () => {
  it("совместное пребывание в радиусе растит связь до порога дружбы", () => {
    const bonds = new Map<string, BondRecord>();
    const a = makeTestCreature({ id: "a", pos: { x: 100, y: 100 } });
    const b = makeTestCreature({ id: "b", pos: { x: 110, y: 100 } });
    const threshold = getSimConstants().social.friendship.threshold;
    const growth = getSimConstants().social.bond_growth_per_tick_within_radius;
    const ticksNeeded = Math.ceil(threshold / growth) + 1;
    for (let i = 0; i < ticksNeeded; i++) growBondForPair(a, b, bonds);
    const record = bonds.get(bondKey("a", "b"));
    expect(record!.strength).toBeGreaterThanOrEqual(threshold);
    expect(record!.kind).toBe("friend");
  });

  it("пары вне радиуса не образуют связь", () => {
    const bonds = new Map<string, BondRecord>();
    const a = makeTestCreature({ id: "a", pos: { x: 0, y: 0 } });
    const b = makeTestCreature({ id: "b", pos: { x: 5000, y: 5000 } });
    growBondForPair(a, b, bonds);
    expect(bonds.size).toBe(0);
  });

  it("необновлённая связь затухает и распадается ниже decay_below (bond_broken)", () => {
    const bonds = new Map<string, BondRecord>();
    bonds.set(bondKey("a", "b"), { creatureA: "a", creatureB: "b", kind: "friend", strength: 0.25 });
    const decayPerTick = getSimConstants().social.bond_decay_per_tick_apart;
    let broken: BondRecord[] = [];
    for (let i = 0; i < Math.ceil(0.06 / decayPerTick) + 1; i++) {
      broken = decayUntouchedBonds(bonds, new Set());
      if (broken.length > 0) break;
    }
    expect(broken).toHaveLength(1);
    expect(bonds.size).toBe(0);
  });
});

describe("social: избегание (aversions, направленное)", () => {
  it("избегание направлено: subject боится object, обратного не создаётся", () => {
    const aversions = new Map<string, AversionRecord>();
    recordAversion(aversions, "penguin1", "orca1", 0.8);
    expect(aversions.size).toBe(1);
    const [record] = aversions.values();
    expect(record.subjectId).toBe("penguin1");
    expect(record.objectId).toBe("orca1");
  });

  it("затухает за реальное время и удаляется при приближении к нулю", () => {
    const aversions = new Map<string, AversionRecord>();
    recordAversion(aversions, "s", "o", 0.05);
    decayAversions(aversions, 86400 * 10);
    expect(aversions.size).toBe(0);
  });
});
