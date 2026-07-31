import type { Rng } from "./rng.js";
import { getSimConstants } from "./simConstants.js";
import { NameGenerator } from "./names.js";
import { randomTraits, randomChronotype } from "./traits.js";
import { computeAuthority } from "./authority.js";
import { realDaysToTicks } from "./time.js";
import { ageStageFor } from "./lifecycle.js";
import { buildZoneLayout, zoneAt } from "../world/zones.js";
import {
  SKILL_KEYS,
  type Creature,
  type DecisionWeights,
  type Sex,
  type Skills,
  type Species,
  type Vector2,
} from "./types.js";

function randomSkills(rng: Rng): Skills {
  const max = getSimConstants().skills.genesis_initial_max;
  const skills = {} as Skills;
  for (const key of SKILL_KEYS) skills[key] = rng.range(0, max);
  return skills;
}

/** Веса U(a) "по умолчанию" (6.1) — собственная независимая копия на каждую особь. */
export function defaultWeights(species: Species): DecisionWeights {
  const { weight_defaults } = getSimConstants().utility_ai;
  const weights: DecisionWeights = {
    w_need: { ...weight_defaults.w_need },
    w_trait: weight_defaults.w_trait,
    w_skill: weight_defaults.w_skill,
    w_habit: weight_defaults.w_habit,
  };
  if (species === "orca") {
    weights.hunt_attractiveness = { ...getSimConstants().hunting.attractiveness_weight_defaults };
  }
  return weights;
}

function spawnPosition(species: Species, rng: Rng): Vector2 {
  const zones = buildZoneLayout();
  const zoneName = species === "penguin" ? "main_ice" : "open_water";
  const zone = zones.find((z) => z.name === zoneName);
  if (!zone) throw new Error(`spawnPosition: зона ${zoneName} не найдена`);
  return { x: rng.range(zone.x0, zone.x1), y: rng.range(zone.y0, zone.y1) };
}

export interface GenesisOptions {
  tick: number;
  rng: Rng;
  nameGen: NameGenerator;
  nextId: () => string;
}

/**
 * Создаёт genesis-особь (6.1): случайные черты, стартовые навыки около
 * нуля, нейтральные оценки зон, веса решений по умолчанию, без родителей.
 * Возраст особи выбирается случайно внутри стадии "взрослый" (не 0) — иначе
 * genesis-популяция не могла бы размножаться, пока не пройдёт стадия
 * "детёныш" (инженерное решение, ТЗ не задаёт возраст genesis явно).
 */
export function createGenesisCreature(species: Species, sex: Sex, opts: GenesisOptions): Creature {
  const { tick, rng, nameGen, nextId } = opts;
  const constants = getSimConstants();
  const stages = species === "penguin" ? constants.life_stages.penguin_weeks : constants.life_stages.orca_weeks;
  const ageWeeks = rng.range(stages.juvenile, stages.adult);
  // ageWeeks (внутренние недели) численно равны реальным суткам (6.2, sim/time.ts).
  const bornAtTick = tick - realDaysToTicks(ageWeeks);

  const traits = randomTraits(rng);
  const pos = spawnPosition(species, rng);
  const weights = defaultWeights(species);

  const creature: Creature = {
    id: nextId(),
    species,
    name: nameGen.nameFor(species),
    sex,
    bornAtTick,
    pos,
    velocity: { x: 0, y: 0 },
    zone: zoneAt(pos.x, pos.y).name,
    traits,
    traitsBirth: { ...traits },
    needs: { ...constants.population.genesis_initial_needs },
    emotion: { ...constants.population.genesis_initial_emotion },
    intentions: [],
    skills: randomSkills(rng),
    chronotype: randomChronotype(rng),
    isAsleep: false,
    ageStage: ageStageFor(species, ageWeeks),
    authority: 0,
    habits: {},
    weights,
    weightsBirth: structuredClone(weights),
    lastReflectionAt: tick,
    continuousStarvationRealHours: 0,
    awakeSinceTick: tick,
    episodes: [],
    perceivedStates: new Map(),
    perceivedZoneThreat: new Map(),
    trust: new Map(),
    cohortId: `${species}-genesis`,
    actionCounts: {},
    narrativeFacts: [],
  };
  creature.authority = computeAuthority(creature, ageWeeks);
  return creature;
}

export function createGenesisPopulation(tick: number, rng: Rng, nameGen: NameGenerator, nextId: () => string): Creature[] {
  const { genesis } = getSimConstants().population;
  const creatures: Creature[] = [];
  for (let i = 0; i < genesis.penguins; i++) {
    creatures.push(createGenesisCreature("penguin", i % 2 === 0 ? "m" : "f", { tick, rng, nameGen, nextId }));
  }
  for (let i = 0; i < genesis.orcas; i++) {
    creatures.push(createGenesisCreature("orca", i % 2 === 0 ? "m" : "f", { tick, rng, nameGen, nextId }));
  }
  return creatures;
}
