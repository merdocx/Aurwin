import { describe, expect, it } from "vitest";
import { decide } from "../src/sim/utilityAI.js";
import { Rng } from "../src/sim/rng.js";
import { getSimConstants } from "../src/sim/simConstants.js";
import { makeTestCreature } from "./testCreature.js";

describe("utilityAI.decide (А.4)", () => {
  it("два пингвина с разными чертами в одинаковой ситуации выбирают разные действия при выключенном шуме (цель 2)", () => {
    // Общительный, любопытный, бесстрашный пингвин рядом с другом.
    const social = makeTestCreature({
      id: "social",
      traits: { courage: 0.8, curiosity: 0.8, sociability: 0.9, aggression: 0, caution: -0.8, expressiveness: 0 },
      needs: { hunger: 0.2, energy: 0.8, social: 0.9, sleep_pressure: 0.1 },
    });
    // Осторожный, необщительный, голодный пингвин в той же ситуации.
    const cautious = makeTestCreature({
      id: "cautious",
      traits: { courage: -0.8, curiosity: -0.8, sociability: -0.9, aggression: 0, caution: 0.9, expressiveness: 0 },
      needs: { hunger: 0.9, energy: 0.8, social: 0.1, sleep_pressure: 0.1 },
      zone: "south_shallows",
      pos: { x: 100, y: 100 },
    });
    const friend = makeTestCreature({ id: "friend", pos: { x: 110, y: 100 }, zone: "main_ice" });
    const friendForCautious = makeTestCreature({ id: "friend2", pos: { x: 100, y: 100 }, zone: "south_shallows" });

    const fishAvailability = () => 0.8;
    const bondStrength = (id: string) => (id === "friend" ? 0.9 : 0);

    const decisionSocial = decide({
      creature: social,
      currentTick: 1000,
      phase: "day",
      visible: [friend],
      fishAvailability,
      bondStrength,
      aversionStrength: () => 0,
      rng: new Rng(1),
      noiseMaxOverride: 0,
    });

    const decisionCautious = decide({
      creature: cautious,
      currentTick: 1000,
      phase: "day",
      visible: [friendForCautious],
      fishAvailability,
      bondStrength: () => 0,
      aversionStrength: () => 0,
      rng: new Rng(1),
      noiseMaxOverride: 0,
    });

    expect(decisionSocial.action).not.toBe(decisionCautious.action);
  });

  it("детерминированность при фиксированном seed (А.8, п.1)", () => {
    const creature = makeTestCreature({
      traits: { courage: 0.3, curiosity: 0.5, sociability: 0.2, aggression: -0.1, caution: 0.4, expressiveness: 0.1 },
    });
    const ctx = {
      creature: structuredClone(creature),
      currentTick: 500,
      phase: "day" as const,
      visible: [],
      fishAvailability: () => 0.5,
      bondStrength: () => 0,
      aversionStrength: () => 0,
      rng: new Rng(42),
    };
    const ctx2 = { ...ctx, creature: structuredClone(creature), rng: new Rng(42) };

    const d1 = decide(ctx);
    const d2 = decide(ctx2);
    expect(d1.action).toBe(d2.action);
    expect(d1.factors[0].utility).toBeCloseTo(d2.factors[0].utility, 10);
  });

  it("амплитуда шума строго меньше типичного вклада черт (защита атрибутируемости, А.4)", () => {
    const creature = makeTestCreature({
      traits: { courage: 0.7, curiosity: 0.9, sociability: 0, aggression: 0, caution: -0.7, expressiveness: 0 },
    });
    const decision = decide({
      creature,
      currentTick: 100,
      phase: "day",
      visible: [],
      fishAvailability: () => 0,
      bondStrength: () => 0,
      aversionStrength: () => 0,
      rng: new Rng(3),
    });
    const wander = decision.factors.find((f) => f.action === "wander")!;
    const noiseMax = getSimConstants().utility_ai.noise_epsilon_max;
    const traitContribution = Math.abs(wander.breakdown.trait);
    expect(traitContribution).toBeGreaterThan(0);
    expect(noiseMax).toBeLessThan(traitContribution);
  });

  it("касатка ранжирует жертв по воспринимаемой, а не истинной бодрости (7.8.3)", () => {
    const orca = makeTestCreature({
      id: "orca",
      species: "orca",
      pos: { x: 500, y: 500 },
      needs: { hunger: 0.9, energy: 0.8, social: 0.2, sleep_pressure: 0.1 },
      zone: "open_water",
    });
    const weakLooking = makeTestCreature({
      id: "preyA",
      species: "penguin",
      pos: { x: 520, y: 500 },
      zone: "open_water",
    });
    const strongLooking = makeTestCreature({
      id: "preyB",
      species: "penguin",
      pos: { x: 520, y: 520 },
      zone: "open_water",
    });

    // Истинная бодрость обеих жертв одинаковая (одинаковые needs/skills),
    // но касатка ВОСПРИНИМАЕТ preyB как более слабую — например, из-за
    // сигнала. Выбор цели должен пойти по восприятию.
    orca.perceivedStates.set("preyA", { perceivedVigor: 0.9, perceivedThreat: 0, lastSignalTick: -1 });
    orca.perceivedStates.set("preyB", { perceivedVigor: 0.1, perceivedThreat: 0, lastSignalTick: -1 });

    const decision = decide({
      creature: orca,
      currentTick: 100,
      phase: "day",
      visible: [weakLooking, strongLooking],
      fishAvailability: () => 0,
      bondStrength: () => 0,
      aversionStrength: () => 0,
      rng: new Rng(7),
      noiseMaxOverride: 0,
    });

    expect(decision.action).toBe("hunt");
    expect(decision.targetId).toBe("preyB");
  });
});
