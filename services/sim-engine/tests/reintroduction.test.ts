import { describe, expect, it } from "vitest";
import { processReintroduction } from "../src/sim/reintroduction.js";
import { NameGenerator } from "../src/sim/names.js";
import { Rng } from "../src/sim/rng.js";
import { getSimConstants } from "../src/sim/simConstants.js";

describe("реинтродукция при вымирании вида (7.4)", () => {
  it("подселяет genesis-когорту, когда численность вида = reintroduce_at (0)", () => {
    const rng = new Rng(42);
    const nameGen = new NameGenerator();
    const { genesis } = getSimConstants().population;
    let id = 0;

    const result = processReintroduction({
      tick: 1000,
      rng,
      nameGen,
      nextId: () => `reintro-${++id}`,
      ticksPerInnerDay: 6120,
      countAlive: (species) => (species === "penguin" ? 0 : genesis.orcas),
      lastReintroductionTick: {},
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ species: "penguin", count: genesis.penguins, tick: 1000 });
    expect(result.creatures).toHaveLength(genesis.penguins);
    expect(result.creatures.every((c) => c.species === "penguin" && c.cohortId === "penguin-reintro-1000")).toBe(true);
    expect(result.creatures.every((c) => c.narrativeFacts.length === 1 && c.narrativeFacts[0].includes("начинаю"))).toBe(true);
  });

  it("не повторяет реинтродукцию того же вида раньше cooldown_inner_days", () => {
    const rng = new Rng(7);
    const nameGen = new NameGenerator();
    const ticksPerInnerDay = 6120;
    const cooldown = getSimConstants().reproduction.cooldown_inner_days;
    let id = 0;
    const deps = {
      tick: 5000,
      rng,
      nameGen,
      nextId: () => `r-${++id}`,
      ticksPerInnerDay,
      countAlive: () => 0,
      lastReintroductionTick: { penguin: 5000 - ticksPerInnerDay * cooldown + 1 },
    };

    const result = processReintroduction(deps);
    expect(result.events.filter((e) => e.species === "penguin")).toHaveLength(0);
  });

  it("разрешает повторную реинтродукцию после истечения кулдауна", () => {
    const rng = new Rng(9);
    const nameGen = new NameGenerator();
    const ticksPerInnerDay = 6120;
    const cooldown = getSimConstants().reproduction.cooldown_inner_days;
    let id = 0;

    const result = processReintroduction({
      tick: 9000,
      rng,
      nameGen,
      nextId: () => `r2-${++id}`,
      ticksPerInnerDay,
      countAlive: (species) => (species === "orca" ? 0 : 10),
      lastReintroductionTick: { orca: 9000 - ticksPerInnerDay * cooldown },
    });

    expect(result.events.some((e) => e.species === "orca")).toBe(true);
  });
});

describe("Simulation: реинтродукция в конце тика", () => {
  it("восстанавливает пингвинов после ручного обнуления популяции", async () => {
    const { Simulation } = await import("../src/sim/simulation.js");
    const { getSimConstants } = await import("../src/sim/simConstants.js");
    const sim = new Simulation(123);
    const { genesis } = getSimConstants().population;

    for (const c of [...sim.creatures.values()]) {
      if (c.species === "penguin") sim.creatures.delete(c.id);
    }
    expect(sim.aliveCreatures().filter((c) => c.species === "penguin")).toHaveLength(0);

    sim.tick();

    const penguins = sim.aliveCreatures().filter((c) => c.species === "penguin");
    expect(penguins).toHaveLength(genesis.penguins);
    expect(sim.recentWorldEvents.some((e) => e.type === "reintroduction")).toBe(true);
  });
});
