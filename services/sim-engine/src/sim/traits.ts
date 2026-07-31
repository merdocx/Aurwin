import { clamp, type Rng } from "./rng.js";
import { getSimConstants } from "./simConstants.js";
import { TRAIT_KEYS, type Traits } from "./types.js";

const TRAIT_RANGE: [number, number] = [-1, 1];

/** Случайные черты genesis-особи, равномерно по всем шкалам -1..1 (6.1). */
export function randomTraits(rng: Rng): Traits {
  const traits = {} as Traits;
  for (const key of TRAIT_KEYS) {
    traits[key] = rng.range(TRAIT_RANGE[0], TRAIT_RANGE[1]);
  }
  return traits;
}

export function randomChronotype(rng: Rng): number {
  const [min, max] = getSimConstants().day_night.chronotype_trait_range;
  return rng.range(min, max);
}

/**
 * Черты потомства: смешение черт родителей + случайная мутация в пределах
 * диапазона (7.4, "второй механизм поддержания разнообразия"). Черта
 * expressiveness мутирует отдельным (обычно более широким) stddev — она
 * прямо является предметом отбора сигнальной системы (7.8.5) и не должна
 * зависеть от общего для темперамента шага мутации.
 */
export function inheritTraits(a: Traits, b: Traits, rng: Rng): Traits {
  const { trait_mutation_stddev, expressiveness_mutation_stddev } = getSimConstants().reproduction;
  const traits = {} as Traits;
  for (const key of TRAIT_KEYS) {
    const mean = (a[key] + b[key]) / 2;
    const stddev = key === "expressiveness" ? expressiveness_mutation_stddev : trait_mutation_stddev;
    traits[key] = clamp(rng.gaussian(mean, stddev), TRAIT_RANGE[0], TRAIT_RANGE[1]);
  }
  return traits;
}

export function inheritChronotype(a: number, b: number, rng: Rng): number {
  const { chronotype_mutation_stddev } = getSimConstants().reproduction;
  const [min, max] = getSimConstants().day_night.chronotype_trait_range;
  const mean = (a + b) / 2;
  return clamp(rng.gaussian(mean, chronotype_mutation_stddev), min, max);
}
