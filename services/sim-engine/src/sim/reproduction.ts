import { clamp, type Rng } from "./rng.js";
import { getSimConstants } from "./simConstants.js";
import { NameGenerator } from "./names.js";
import { inheritChronotype, inheritTraits } from "./traits.js";
import { defaultWeights, starterNarrativeFact } from "./genesis.js";
import { computeAuthority } from "./authority.js";
import { ageStageFor } from "./lifecycle.js";
import { ticksToInternalDays, ticksToRealDays } from "./time.js";
import { ecoZoneAtSim } from "../world/landMask.js";
import { SKILL_KEYS, type AgeStage, type Creature, type DecisionWeights, type Skills } from "./types.js";

/**
 * Запрет близкого инбридинга на глубину 2 поколений (7.4): не
 * родитель/потомок (проверка parent_a/parent_b напрямую — 1 поколение) и
 * не полные сиблинги (общие оба родителя — тот же уровень parent_a/parent_b,
 * но у ОБОИХ кандидатов, что фактически исключает пары с общим предком в
 * пределах 2 поколений без хранения полной родословной).
 */
export function isForbiddenPair(a: Creature, b: Creature): boolean {
  if (a.parentA === b.id || a.parentB === b.id || b.parentA === a.id || b.parentB === a.id) {
    return true;
  }
  if (a.parentA && a.parentB && b.parentA && b.parentB) {
    const parentsA = new Set([a.parentA, a.parentB]);
    const parentsB = new Set([b.parentA, b.parentB]);
    if (parentsA.size === parentsB.size && [...parentsA].every((p) => parentsB.has(p))) {
      return true;
    }
  }
  return false;
}

export interface MatingCheck {
  ageStageA: AgeStage;
  ageStageB: AgeStage;
  bondStrength: number;
  currentTick: number;
}

/** Условия размножения (7.4): разнополость, оба взрослые, сытость, связь, запрет инбридинга, кулдаун. */
export function canMate(a: Creature, b: Creature, check: MatingCheck): boolean {
  const constants = getSimConstants().reproduction;
  if (a.species !== b.species) return false;
  if (a.sex === b.sex) return false;
  if (check.ageStageA !== "adult" || check.ageStageB !== "adult") return false;
  if (isForbiddenPair(a, b)) return false;
  if (a.needs.hunger > constants.max_hunger_to_mate) return false;
  if (b.needs.hunger > constants.max_hunger_to_mate) return false;
  if (check.bondStrength < constants.min_bond_strength_to_mate) return false;
  for (const parent of [a, b]) {
    if (parent.lastReproducedAtTick !== undefined) {
      const sinceDays = ticksToInternalDays(check.currentTick - parent.lastReproducedAtTick);
      if (sinceDays < constants.cooldown_inner_days) return false;
    }
  }
  return true;
}

function inheritHabits(parentA: Creature, parentB: Creature, rng: Rng): Creature["habits"] {
  const { habit_weight, habit_noise_amplitude } = getSimConstants().reproduction.culture_inherit;
  const habits: Creature["habits"] = {};
  const zones = new Set([...Object.keys(parentA.habits), ...Object.keys(parentB.habits)]);
  for (const zone of zones) {
    const parentalMean = ((parentA.habits[zone as keyof Creature["habits"]] ?? 0) + (parentB.habits[zone as keyof Creature["habits"]] ?? 0)) / 2;
    habits[zone as keyof Creature["habits"]] = clamp(parentalMean * habit_weight + rng.noise(habit_noise_amplitude), -1, 1);
  }
  return habits;
}

function inheritWeights(species: Creature["species"], parentA: Creature, parentB: Creature): DecisionWeights {
  const defaults = defaultWeights(species);
  const { weights_blend } = getSimConstants().reproduction.culture_inherit;
  const corridor = getSimConstants().reflection.weight_lifetime_corridor;
  const blend = (base: number, a: number, b: number) => clamp(base + ((a + b) / 2 - base) * weights_blend, base - corridor, base + corridor);

  const weights = structuredClone(defaults);
  weights.w_trait = blend(defaults.w_trait, parentA.weights.w_trait, parentB.weights.w_trait);
  weights.w_skill = blend(defaults.w_skill, parentA.weights.w_skill, parentB.weights.w_skill);
  weights.w_habit = blend(defaults.w_habit, parentA.weights.w_habit, parentB.weights.w_habit);
  for (const key of ["hunger", "energy", "social", "sleep"] as const) {
    weights.w_need[key] = blend(defaults.w_need[key], parentA.weights.w_need[key], parentB.weights.w_need[key]);
  }
  if (weights.hunt_attractiveness && parentA.weights.hunt_attractiveness && parentB.weights.hunt_attractiveness) {
    for (const key of ["w_vigor", "w_dist", "w_group", "w_stage"] as const) {
      weights.hunt_attractiveness[key] = blend(
        defaults.hunt_attractiveness![key],
        parentA.weights.hunt_attractiveness[key],
        parentB.weights.hunt_attractiveness[key],
      );
    }
  }
  return weights;
}

export function createOffspring(
  parentA: Creature,
  parentB: Creature,
  tick: number,
  rng: Rng,
  nameGen: NameGenerator,
  nextId: () => string,
): Creature {
  const constants = getSimConstants();
  const species = parentA.species;
  const traits = inheritTraits(parentA.traits, parentB.traits, rng);
  const chronotype = inheritChronotype(parentA.chronotype, parentB.chronotype, rng);
  const sex = rng.bool(0.5) ? "m" : "f";
  const pos = { ...parentA.pos };
  const weights = inheritWeights(species, parentA, parentB);
  const skills = {} as Skills;
  const { skill_seed } = constants.reproduction.culture_inherit;
  for (const key of SKILL_KEYS) skills[key] = clamp(((parentA.skills[key] + parentB.skills[key]) / 2) * skill_seed, 0, constants.skills.cap);

  const creature: Creature = {
    id: nextId(),
    species,
    name: nameGen.nameFor(species),
    sex,
    bornAtTick: tick,
    parentA: parentA.id,
    parentB: parentB.id,
    pos,
    velocity: { x: 0, y: 0 },
    zone: ecoZoneAtSim(pos.x, pos.y),
    traits,
    traitsBirth: { ...traits },
    needs: { ...constants.population.genesis_initial_needs },
    emotion: { ...constants.population.genesis_initial_emotion },
    intentions: [],
    skills,
    chronotype,
    isAsleep: false,
    activity: "idle",
    ageStage: ageStageFor(species, 0),
    authority: 0,
    habits: inheritHabits(parentA, parentB, rng),
    weights,
    weightsBirth: structuredClone(weights),
    lastReflectionAt: tick,
    continuousStarvationRealHours: 0,
    awakeSinceTick: tick,
    episodes: [],
    perceivedStates: new Map(),
    perceivedZoneThreat: new Map(),
    trust: new Map(),
    cohortId: `${species}-d${Math.floor(ticksToRealDays(tick))}`,
    actionCounts: {},
    narrativeFacts: [starterNarrativeFact("birth")],
  };
  creature.authority = computeAuthority(creature, 0);
  return creature;
}
