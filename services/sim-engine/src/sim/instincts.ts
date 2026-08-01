import { clamp, type Rng } from "./rng.js";
import { getSimConstants } from "./simConstants.js";
import type { Creature, Instincts, Species, SpeciesAffect, Traits } from "./types.js";
import type { ZoneName } from "../world/zones.js";

const ALL_ZONES: ZoneName[] = ["far_ice", "main_ice", "south_shallows", "north_bay", "open_water"];
const LAND_ZONES: ZoneName[] = ["main_ice", "far_ice"];

/** Видовой seed инстинктов из yaml + лёгкий шум × caution/aggression. */
export function seedInstincts(species: Species, traits: Traits, rng: Rng): Instincts {
  const cfg = getSimConstants().instincts[species];
  const cautionBoost = Math.max(0, traits.caution) * 0.08;
  const aggressionBoost = Math.max(0, traits.aggression) * 0.06;

  const speciesAffect: Instincts["speciesAffect"] = {};
  for (const [other, affect] of Object.entries(cfg.species_affect) as Array<[Species, { threat: number; value: number }]>) {
    const threatNoise = rng.noise(0.04);
    const valueNoise = rng.noise(0.04);
    speciesAffect[other] = {
      threat: clamp(affect.threat + (species === "penguin" && other === "orca" ? cautionBoost : 0) + threatNoise, 0, 1),
      value: clamp(affect.value + (species === "orca" && other === "penguin" ? aggressionBoost : 0) + valueNoise, 0, 1),
    };
  }

  return {
    speciesAffect,
    needDrive: {
      hungerSeekFood: clamp(cfg.need_drive.hunger_seek_food + rng.noise(0.03), 0, 1),
      hungerSeekPrey: clamp(cfg.need_drive.hunger_seek_prey + rng.noise(0.03), 0, 1),
    },
    mediumBias: {
      land: clamp(cfg.medium_bias.land + (species === "penguin" ? cautionBoost * 0.5 : 0) + rng.noise(0.02), -1, 1),
      water: clamp(cfg.medium_bias.water + rng.noise(0.02), -1, 1),
    },
  };
}

/** Дети: видовой seed + mild overlay от среднего родителей. */
export function inheritInstincts(species: Species, traits: Traits, parentA: Creature, parentB: Creature, rng: Rng): Instincts {
  const base = seedInstincts(species, traits, rng);
  const overlay = getSimConstants().reproduction.culture_inherit.instinct_parent_overlay;
  if (overlay <= 0) return base;

  const blendAffect = (key: Species): SpeciesAffect => {
    const b = base.speciesAffect[key] ?? { threat: 0, value: 0 };
    const a = parentA.instincts.speciesAffect[key] ?? b;
    const p = parentB.instincts.speciesAffect[key] ?? b;
    return {
      threat: clamp(b.threat * (1 - overlay) + ((a.threat + p.threat) / 2) * overlay, 0, 1),
      value: clamp(b.value * (1 - overlay) + ((a.value + p.value) / 2) * overlay, 0, 1),
    };
  };

  for (const key of ["penguin", "orca"] as Species[]) {
    if (base.speciesAffect[key] || parentA.instincts.speciesAffect[key] || parentB.instincts.speciesAffect[key]) {
      base.speciesAffect[key] = blendAffect(key);
    }
  }

  base.needDrive.hungerSeekFood = clamp(
    base.needDrive.hungerSeekFood * (1 - overlay) +
      ((parentA.instincts.needDrive.hungerSeekFood + parentB.instincts.needDrive.hungerSeekFood) / 2) * overlay,
    0,
    1,
  );
  base.needDrive.hungerSeekPrey = clamp(
    base.needDrive.hungerSeekPrey * (1 - overlay) +
      ((parentA.instincts.needDrive.hungerSeekPrey + parentB.instincts.needDrive.hungerSeekPrey) / 2) * overlay,
    0,
    1,
  );
  base.mediumBias.land = clamp(
    base.mediumBias.land * (1 - overlay) + ((parentA.instincts.mediumBias.land + parentB.instincts.mediumBias.land) / 2) * overlay,
    -1,
    1,
  );
  base.mediumBias.water = clamp(
    base.mediumBias.water * (1 - overlay) + ((parentA.instincts.mediumBias.water + parentB.instincts.mediumBias.water) / 2) * overlay,
    -1,
    1,
  );
  return base;
}

export function innateSpeciesThreat(creature: Creature, otherSpecies: Species): number {
  return creature.instincts.speciesAffect[otherSpecies]?.threat ?? 0;
}

export function innateSpeciesValue(creature: Creature, otherSpecies: Species): number {
  return creature.instincts.speciesAffect[otherSpecies]?.value ?? 0;
}

function isLandZone(zone: ZoneName): boolean {
  return zone === "main_ice" || zone === "far_ice";
}

/**
 * Выученная + врождённая «безопасность» зоны. ZONE_RISK больше не авторитет —
 * только слабый bootstrap через mediumBias / caution.
 */
export function safetyScore(creature: Creature, zone: ZoneName): number {
  const habit = creature.habits[zone] ?? 0;
  const threat = creature.perceivedZoneThreat.get(zone) ?? 0;
  const medium = isLandZone(zone) ? creature.instincts.mediumBias.land : creature.instincts.mediumBias.water;
  return habit * 0.55 - threat * 0.65 + medium * 0.35 - Math.max(0, creature.traits.caution) * (isLandZone(zone) ? 0 : 0.08);
}

/** Лучшая зона-убежище (приоритет суши, если на воде и виден хищник). */
export function bestSafetyZone(creature: Creature, preferLand: boolean): ZoneName {
  const pool = preferLand ? LAND_ZONES : ALL_ZONES;
  let best: ZoneName = pool[0];
  let bestScore = -Infinity;
  for (const zone of pool) {
    const s = safetyScore(creature, zone);
    if (s > bestScore) {
      bestScore = s;
      best = zone;
    }
  }
  return best;
}

/** Bias от core / значимых эпизодов в оценку U(a). */
export function episodeActionBias(creature: Creature, action: string, zone: ZoneName | undefined, targetId: string | undefined): number {
  let total = 0;
  for (const ep of creature.episodes) {
    if (!ep.coreMemory && ep.significance < 0.45) continue;
    const w = ep.coreMemory ? 1 : ep.significance;
    if (ep.type === "hunt_attempt_survived_by_prey") {
      if (action === "flee") total += 0.12 * w;
      if (zone && ep.zone === zone && (action === "goto_food" || action === "eat" || action === "wander")) total -= 0.18 * w;
      if (zone && (zone === "main_ice" || zone === "far_ice") && (action === "flee" || action === "goto_food")) total += 0.1 * w;
    }
    if (ep.type === "hunt_attempt_failed_by_hunter" && (action === "hunt" || action === "stealth_approach") && targetId && ep.participants.includes(targetId)) {
      total -= 0.08 * w;
    }
    if (ep.type === "hunt_success" && (action === "hunt" || action === "coordinate_hunt")) total += 0.1 * w;
    if (ep.type === "friend_died" && action === "flee") total += 0.06 * w;
  }
  return total;
}
