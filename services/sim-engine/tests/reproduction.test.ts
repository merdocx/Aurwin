import { describe, expect, it } from "vitest";
import { Simulation } from "../src/sim/simulation.js";
import { decayUntouchedBonds } from "../src/sim/social.js";
import { getSimConstants } from "../src/sim/simConstants.js";
import { bondKey, type BondRecord, type Creature } from "../src/sim/types.js";
import { realDaysToTicks } from "../src/sim/time.js";
import { makeTestCreature } from "./testCreature.js";

function adultPair(kind: "friend" | "mate") {
  const tick = realDaysToTicks(5);
  const born = tick - realDaysToTicks(3); // adult penguin (≥1.5 wk)
  const male = makeTestCreature({
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
    sex: "m",
    species: "penguin",
    bornAtTick: born,
    ageStage: "adult",
    needs: { hunger: 0.1, energy: 0.9, social: 0.2, sleep_pressure: 0.1 },
    pos: { x: 200, y: 200 },
    zone: "main_ice",
  });
  const female = makeTestCreature({
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2",
    sex: "f",
    species: "penguin",
    bornAtTick: born,
    ageStage: "adult",
    needs: { hunger: 0.1, energy: 0.9, social: 0.2, sleep_pressure: 0.1 },
    pos: { x: 205, y: 200 },
    zone: "main_ice",
  });
  // Держим оба вида выше порога реинтродукции (alert min), чтобы не плодить genesis mid-test.
  const fillers: Creature[] = [];
  for (let i = 0; i < 6; i++) {
    fillers.push(
      makeTestCreature({
        id: `bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb${i}`,
        sex: i % 2 === 0 ? "m" : "f",
        species: "penguin",
        bornAtTick: born,
        ageStage: "adult",
        pos: { x: 400 + i * 30, y: 400 },
        zone: "main_ice",
      }),
    );
  }
  for (let i = 0; i < 2; i++) {
    fillers.push(
      makeTestCreature({
        id: `cccccccc-cccc-cccc-cccc-cccccccccc${i}`,
        sex: i % 2 === 0 ? "m" : "f",
        species: "orca",
        bornAtTick: born - realDaysToTicks(10),
        ageStage: "adult",
        pos: { x: 50 + i * 40, y: 50 },
        zone: "open_water",
      }),
    );
  }
  const bond: BondRecord = {
    creatureA: male.id < female.id ? male.id : female.id,
    creatureB: male.id < female.id ? female.id : male.id,
    kind,
    strength: 0.85,
  };
  return { tick, male, female, bond, creatures: [male, female, ...fillers] };
}

describe("reproduction: только пара (mate)", () => {
  it("сильная дружба без контакта/court не даёт рождений от этой пары", () => {
    const { tick, male, female, bond, creatures } = adultPair("friend");
    // Держим пару вне радиуса восприятия/близости — court и birth невозможны без встречи.
    male.pos = { x: 40, y: 40 };
    male.zone = "far_ice";
    female.pos = { x: 900, y: 520 };
    female.zone = "south_shallows";
    const sim = new Simulation(
      42,
      { mockReflectionEnabled: false },
      { tick, creatures, bonds: [bond], aversions: [] },
    );
    for (let i = 0; i < 800; i++) sim.tick();
    const birthsFromPair = sim.recentWorldEvents.filter(
      (e) =>
        e.type === "birth" &&
        e.payload &&
        ((e.payload as { parentA?: string }).parentA === male.id ||
          (e.payload as { parentB?: string }).parentB === male.id),
    );
    expect(birthsFromPair).toHaveLength(0);
    // Без court kind остаётся friend (или bond распался в разлуке) — не mate через рождение.
    const left = sim.bonds.get(bondKey(male.id, female.id));
    if (left) expect(left.kind).toBe("friend");
  });

  it("mate-пара может родить ребёнка", () => {
    const { tick, male, female, bond, creatures } = adultPair("mate");
    const sim = new Simulation(
      7,
      { mockReflectionEnabled: false },
      { tick, creatures, bonds: [bond], aversions: [] },
    );
    let birthEvent: (typeof sim.recentWorldEvents)[number] | undefined;
    for (let i = 0; i < 4000; i++) {
      sim.tick();
      birthEvent = sim.recentWorldEvents.find(
        (e) =>
          e.type === "birth" &&
          e.payload &&
          [male.id, female.id].includes((e.payload as { parentA: string }).parentA) &&
          [male.id, female.id].includes((e.payload as { parentB: string }).parentB),
      );
      if (birthEvent) break;
    }
    expect(birthEvent).toBeDefined();
    const child = sim.creatures.get(birthEvent!.actorId!);
    expect(child).toBeDefined();
    expect([child!.parentA, child!.parentB].sort()).toEqual([male.id, female.id].sort());
  });

  it("mate может распасться при разлуке (задел под mate_breakup)", () => {
    const bonds = new Map<string, BondRecord>();
    bonds.set(bondKey("a", "b"), {
      creatureA: "a",
      creatureB: "b",
      kind: "mate",
      strength: 0.22,
    });
    const decayPerTick = getSimConstants().social.bond_decay_per_tick_apart;
    let broken: BondRecord[] = [];
    for (let i = 0; i < Math.ceil(0.1 / decayPerTick) + 2; i++) {
      broken = decayUntouchedBonds(bonds, new Set());
      if (broken.length > 0) break;
    }
    expect(broken).toHaveLength(1);
    expect(broken[0]!.kind).toBe("mate");
    expect(bonds.size).toBe(0);
  });
});
