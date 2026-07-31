import type { Rng } from "./rng.js";
import { getSimConstants } from "./simConstants.js";
import { NameGenerator } from "./names.js";
import { inheritChronotype, inheritTraits } from "./traits.js";
import { defaultWeights } from "./genesis.js";
import { computeAuthority } from "./authority.js";
import { ageStageFor } from "./lifecycle.js";
import { ticksToInternalDays, ticksToRealDays } from "./time.js";
import { zoneAt } from "../world/zones.js";
import { SKILL_KEYS, type AgeStage, type Creature, type Skills } from "./types.js";

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
  const weights = defaultWeights(species);
  const skills = {} as Skills;
  const maxSkill = constants.skills.genesis_initial_max;
  for (const key of SKILL_KEYS) skills[key] = rng.range(0, maxSkill);

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
    zone: zoneAt(pos.x, pos.y).name,
    traits,
    traitsBirth: { ...traits },
    needs: { ...constants.population.genesis_initial_needs },
    emotion: { ...constants.population.genesis_initial_emotion },
    intentions: [],
    skills,
    chronotype,
    isAsleep: false,
    ageStage: ageStageFor(species, 0),
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
    cohortId: `${species}-d${Math.floor(ticksToRealDays(tick))}`,
    actionCounts: {},
    narrativeFacts: [],
  };
  creature.authority = computeAuthority(creature, 0);
  return creature;
}
