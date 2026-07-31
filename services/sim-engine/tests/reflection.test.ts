import { describe, expect, it } from "vitest";
import { applyTraitDeltas, applyWeightDeltas, generateMockReflection, shouldTriggerBackgroundReflection } from "../src/sim/reflection.js";
import { getSimConstants } from "../src/sim/simConstants.js";
import { realDaysToTicks } from "../src/sim/time.js";
import { makeTestCreature } from "./testCreature.js";

describe("reflection: заглушка (LLM НЕ подключена, фиксированные намерения)", () => {
  it("возвращает пустые дельты черт/весов", () => {
    const creature = makeTestCreature();
    const result = generateMockReflection(creature);
    expect(result.traitDeltas).toEqual({});
    expect(result.weightDeltas).toEqual({});
    expect(result.intentions.length).toBeGreaterThan(0);
  });

  it("предлагает избегать худшей по личному опыту зоны", () => {
    const creature = makeTestCreature({ habits: { north_bay: -0.5, south_shallows: 0.3 } });
    const result = generateMockReflection(creature);
    expect(result.intentions[0].effect.zone_penalty).toHaveProperty("north_bay");
  });
});

describe("reflection: applyTraitDeltas (clamp + пожизненный коридор, А.3 шаг 1)", () => {
  it("ограничивает дельту за одну рефлексию (±0.1)", () => {
    const creature = makeTestCreature();
    const before = creature.traits.courage;
    applyTraitDeltas(creature, { courage: 5 });
    const clampMax = getSimConstants().reflection.trait_delta_clamp;
    expect(creature.traits.courage).toBeCloseTo(before + clampMax, 5);
  });

  it("не позволяет выйти за пожизненный коридор от traits_birth даже за много применений", () => {
    const creature = makeTestCreature({ traits: { courage: 0, curiosity: 0, sociability: 0, aggression: 0, caution: 0, expressiveness: 0 } });
    creature.traitsBirth = { ...creature.traits };
    for (let i = 0; i < 100; i++) applyTraitDeltas(creature, { courage: 1 });
    const corridor = getSimConstants().reflection.trait_lifetime_corridor;
    expect(creature.traits.courage).toBeLessThanOrEqual(creature.traitsBirth.courage + corridor + 1e-9);
  });
});

describe("reflection: applyWeightDeltas (структура готова к фазе 6)", () => {
  it("ограничивает дельту веса и коридор от weights_birth", () => {
    const creature = makeTestCreature();
    creature.weightsBirth = structuredClone(creature.weights);
    for (let i = 0; i < 100; i++) applyWeightDeltas(creature, { "w_need.hunger": 1 });
    const corridor = getSimConstants().reflection.weight_lifetime_corridor;
    expect(creature.weights.w_need.hunger).toBeLessThanOrEqual(creature.weightsBirth.w_need.hunger + corridor + 1e-9);
  });
});

describe("reflection: фоновая рефлексия привязана к моменту сна (7.10)", () => {
  it("не срабатывает, если существо не заснуло только что", () => {
    const creature = makeTestCreature({ lastReflectionAt: 0 });
    expect(shouldTriggerBackgroundReflection(creature, false, realDaysToTicks(2))).toBe(false);
  });

  it("срабатывает при засыпании после интервала фоновой рефлексии", () => {
    const creature = makeTestCreature({ lastReflectionAt: 0 });
    const intervalTicks = realDaysToTicks(getSimConstants().reflection.background_interval_hours / 24 + 0.01);
    expect(shouldTriggerBackgroundReflection(creature, true, intervalTicks)).toBe(true);
  });

  it("не срабатывает при засыпании раньше интервала", () => {
    const creature = makeTestCreature({ lastReflectionAt: 0 });
    expect(shouldTriggerBackgroundReflection(creature, true, realDaysToTicks(0.1))).toBe(false);
  });
});
