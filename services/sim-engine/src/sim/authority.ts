import { clamp } from "./rng.js";
import { getSimConstants } from "./simConstants.js";
import { maxAgeWeeksFor } from "./lifecycle.js";
import type { Creature } from "./types.js";

/**
 * Авторитетность как источник знания (7.7, механизм 5; формула — А.9):
 * authority = age_weight × (возраст / макс. возраст вида) + profile_skill_weight × профильный навык.
 * "Профильный навык" А.9 явно называет для случая передачи знания об
 * опасности места — evasion ("для опасности места — от evasion и числа
 * пережитых столкновений"). Поскольку главный практический случай
 * вертикальной передачи в ТЗ (7.7, механизм 5) — это именно традиции
 * избегания опасных зон, evasion используется как единый профильный навык
 * авторитетности для обоих видов, а не заводится отдельная формула на вид.
 */
export function computeAuthority(creature: Creature, ageWeeks: number): number {
  const { formula } = getSimConstants().authority;
  const maxAge = maxAgeWeeksFor(creature.species);
  const ageComponent = clamp(ageWeeks / maxAge, 0, 1);
  const profileSkill = creature.skills.evasion;
  return clamp(formula.age_weight * ageComponent + formula.profile_skill_weight * profileSkill, 0, 1);
}

/** Вес передачи знания от источника (7.7, механизм 5): 0.5 + 0.5 × authority. */
export function transmissionWeight(sourceAuthority: number): number {
  const { transmission_weight } = getSimConstants().authority;
  return transmission_weight.base + transmission_weight.authority_weight * sourceAuthority;
}
