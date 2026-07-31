import { clamp } from "./rng.js";
import { getSimConstants } from "./simConstants.js";
import { SKILL_KEYS, type Creature } from "./types.js";
import type { ZoneName } from "../world/zones.js";

/** Рост навыка за успешное применение действия (7.7): +0.02, потолок 0.9. */
export function growSkill(creature: Creature, skill: keyof Creature["skills"]): void {
  const constants = getSimConstants().skills;
  creature.skills[skill] = clamp(creature.skills[skill] + constants.growth_per_success, 0, constants.cap);
}

/** Шаг 10: затухание всех навыков без практики (7.7): −0.002/сутки. */
export function decaySkills(creature: Creature, dtRealSeconds: number): void {
  const constants = getSimConstants().skills;
  const dtDays = dtRealSeconds / 86400;
  for (const key of SKILL_KEYS) {
    creature.skills[key] = clamp(creature.skills[key] - constants.decay_per_day * dtDays, 0, constants.cap);
  }
}

/**
 * Шаг 10: обновление личной карты ожиданий скользящим средним (7.7,
 * механизм 2). `outcome` — нормализованная оценка исхода в зоне: положительная
 * для успешной кормёжки, отрицательная для испуга/голода/нападения.
 */
export function updateHabit(creature: Creature, zone: ZoneName, outcome: number): void {
  const alpha = getSimConstants().skills.habit_moving_average_alpha;
  const current = creature.habits[zone] ?? 0;
  creature.habits[zone] = clamp(current + alpha * (outcome - current), -1, 1);
}
