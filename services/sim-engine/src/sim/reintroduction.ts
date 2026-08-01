import { createGenesisCreature } from "./genesis.js";
import { getSimConstants } from "./simConstants.js";
import type { Rng } from "./rng.js";
import type { NameGenerator } from "./names.js";
import type { Creature, Species } from "./types.js";

export interface ReintroductionDeps {
  tick: number;
  rng: Rng;
  nameGen: NameGenerator;
  nextId: () => string;
  ticksPerInnerDay: number;
  countAlive: (species: Species) => number;
  lastReintroductionTick: Partial<Record<Species, number>>;
}

export interface ReintroductionResult {
  creatures: Creature[];
  events: Array<{ species: Species; count: number; tick: number }>;
  lastReintroductionTick: Partial<Record<Species, number>>;
}

/**
 * Реинтродукция при полном вымирании вида (7.4, population.reintroduction):
 * подселение genesis-когорты с записью в ленту мира. Кулдаун между
 * повторными реинтродукциями одного вида — reproduction.cooldown_inner_days
 * внутренних суток (защита от спама, если новая когорта тоже вымирает сразу).
 */
export function processReintroduction(deps: ReintroductionDeps): ReintroductionResult {
  const constants = getSimConstants();
  const { reintroduction, genesis } = constants.population;
  const threshold = reintroduction.reintroduce_at;
  const cooldownTicks = deps.ticksPerInnerDay * constants.reproduction.cooldown_inner_days;
  const lastTick = { ...deps.lastReintroductionTick };
  const creatures: Creature[] = [];
  const events: ReintroductionResult["events"] = [];

  const speciesPlans: Array<{ species: Species; count: number }> = [
    { species: "penguin", count: genesis.penguins },
    { species: "orca", count: genesis.orcas },
  ];

  for (const { species, count } of speciesPlans) {
    if (deps.countAlive(species) > threshold) continue;

    const last = lastTick[species];
    if (last !== undefined && deps.tick - last < cooldownTicks) continue;

    for (let i = 0; i < count; i++) {
      const creature = createGenesisCreature(species, i % 2 === 0 ? "m" : "f", {
        tick: deps.tick,
        rng: deps.rng,
        nameGen: deps.nameGen,
        nextId: deps.nextId,
      });
      creature.cohortId = `${species}-reintro-${deps.tick}`;
      creatures.push(creature);
    }

    lastTick[species] = deps.tick;
    events.push({ species, count, tick: deps.tick });
  }

  return { creatures, events, lastReintroductionTick: lastTick };
}
