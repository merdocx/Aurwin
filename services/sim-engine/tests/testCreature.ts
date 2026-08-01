import { defaultWeights } from "../src/sim/genesis.js";
import { seedInstincts } from "../src/sim/instincts.js";
import { Rng } from "../src/sim/rng.js";
import type { Creature, Sex, Species, Traits } from "../src/sim/types.js";

let counter = 0;

/** Тестовая фабрика Creature с разумными дефолтами — не часть продакшн-кода. */
export function makeTestCreature(overrides: Partial<Creature> = {}): Creature {
  counter += 1;
  const species: Species = overrides.species ?? "penguin";
  const traits: Traits = overrides.traits ?? {
    courage: 0,
    curiosity: 0,
    sociability: 0,
    aggression: 0,
    caution: 0,
    expressiveness: 0,
  };
  const weights = overrides.weights ?? defaultWeights(species);
  const instincts = overrides.instincts ?? seedInstincts(species, traits, new Rng(counter + 17));

  const base: Creature = {
    id: `test-${counter}`,
    species,
    name: `Test${counter}`,
    sex: (overrides.sex ?? "f") as Sex,
    bornAtTick: 0,
    pos: { x: 100, y: 100 },
    velocity: { x: 0, y: 0 },
    zone: "main_ice",
    traits,
    traitsBirth: { ...traits },
    needs: { hunger: 0.3, energy: 0.8, social: 0.3, sleep_pressure: 0.2 },
    emotion: { valence: 0, arousal: 0.2 },
    intentions: [],
    skills: { foraging: 0.1, evasion: 0.1, socializing: 0.1, hunting: 0.1, parenting: 0.1 },
    chronotype: 0,
    isAsleep: false,
    ageStage: "adult",
    authority: 0,
    habits: {},
    instincts,
    weights,
    weightsBirth: structuredClone(weights),
    lastReflectionAt: 0,
    continuousStarvationRealHours: 0,
    awakeSinceTick: 0,
    episodes: [],
    perceivedStates: new Map(),
    perceivedZoneThreat: new Map(),
    trust: new Map(),
    cohortId: `${species}-test`,
    actionCounts: {},
    narrativeFacts: [],
  };

  return { ...base, ...overrides, instincts: overrides.instincts ?? instincts };
}
