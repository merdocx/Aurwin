import { clamp, type Rng } from "./rng.js";
import { getSimConstants } from "./simConstants.js";
import { ageStageFor, ageWeeksAt, oldAgeDeathProbabilityPerTick } from "./lifecycle.js";
import type { Creature } from "./types.js";

export interface BioClockResult {
  starvedToDeath: boolean;
  diedOfAge: boolean;
}

/**
 * Шаг 3 тик-пайплайна (А.3): голод/энергия/социальная потребность/давление
 * сна/старение. Скорости из `needs_rates`/`day_night.sleep_pressure` уже
 * заданы "за реальные сутки" ПРИ ускорении ×7 (буквальная формулировка
 * А.10), поэтому здесь используется реальное время тика напрямую, без
 * повторного умножения на biological_clock_speedup (иначе ускорение
 * применилось бы дважды) — тот же принцип, что и в `world/dayNight.ts`
 * (фаза 3), который тоже не умножает `inner_day_real_hours` на speedup.
 *
 * "Отдых" в этой модели — это сон: пока существо не спит, оно тратит
 * энергию (даже бездействуя — базовый метаболизм); полноценное
 * восстановление энергии возможно только через действие `sleep` (7.10).
 * Это упрощение (в тексте А.10 "энергия ... +0.8/сут при отдыхе" не
 * определяет "отдых" отдельно от сна) документируется здесь, а не в
 * ops/DEVIATIONS.md, поскольку не меняет ни одно число из А.9/А.10 —
 * только операционализирует недостающее определение "отдыха".
 */
export function advanceBioClocks(creature: Creature, dtRealSeconds: number, hasFriend: boolean): BioClockResult {
  const rates = getSimConstants().needs_rates;
  const sleepPressureRates = getSimConstants().day_night.sleep_pressure;
  const dtDays = dtRealSeconds / 86400;

  creature.needs.hunger = clamp(creature.needs.hunger + rates.hunger_gain_per_day * dtDays, 0, 1);

  if (creature.isAsleep) {
    const recoveryMultiplier = getSimConstants().day_night.sleep_energy_recovery_multiplier;
    creature.needs.energy = clamp(
      creature.needs.energy + rates.energy_gain_rest_per_day * recoveryMultiplier * dtDays,
      0,
      1,
    );
    creature.needs.sleep_pressure = clamp(
      creature.needs.sleep_pressure - sleepPressureRates.loss_per_day_asleep * dtDays,
      0,
      1,
    );
  } else {
    creature.needs.energy = clamp(creature.needs.energy - rates.energy_loss_active_per_day * dtDays, 0, 1);
    creature.needs.sleep_pressure = clamp(
      creature.needs.sleep_pressure + sleepPressureRates.gain_per_day_awake * dtDays,
      0,
      1,
    );
  }

  creature.needs.social = clamp(
    creature.needs.social + (hasFriend ? 0 : rates.social_gain_per_day_alone * dtDays),
    0,
    1,
  );

  // Смерть от голода (А.10): hunger = 1.0 непрерывно 6 реальных часов.
  if (creature.needs.hunger >= 1) {
    creature.continuousStarvationRealHours += dtRealSeconds / 3600;
  } else {
    creature.continuousStarvationRealHours = 0;
  }
  const starvedToDeath = creature.continuousStarvationRealHours >= rates.starvation_death_after_hours;

  return { starvedToDeath, diedOfAge: false };
}

/** Отдельно от advanceBioClocks, т.к. требует текущий tick (не хранится в Creature). */
export function rollOldAgeDeath(creature: Creature, currentTick: number, rng: Rng): boolean {
  const stage = ageStageFor(creature.species, ageWeeksAt(creature.bornAtTick, currentTick));
  if (stage !== "old") return false;
  const p = oldAgeDeathProbabilityPerTick(creature.species, ageWeeksAt(creature.bornAtTick, currentTick));
  return rng.bool(p);
}

/**
 * Смещение полезности действия `sleep` от хронотипа и суток (7.10):
 * "Хронотип ... смещает момент, когда полезность сна превышает полезность
 * прочих действий". Ночью сон полезнее в принципе (nightBonus); хронотип
 * добавляет индивидуальный сдвиг вокруг этого — положительный chronotype
 * ("жаворонок") повышает полезность сна даже вне ночи, отрицательный
 * ("сова") её снижает. Разброс хронотипов в популяции — то, из чего
 * получаются "естественные дозорные" (7.10): не все засыпают одновременно.
 */
export function sleepUtilityBias(creature: Creature, isNight: boolean): number {
  const nightBonus = isNight ? 0.25 : 0;
  const chronotypeBias = creature.chronotype * 0.15;
  return nightBonus + chronotypeBias;
}

export function isFatigued(creature: Creature): boolean {
  return creature.needs.sleep_pressure > getSimConstants().day_night.fatigue_penalty.sleep_pressure_threshold;
}

export function fatigueSkillMultiplier(creature: Creature): number {
  return isFatigued(creature) ? getSimConstants().day_night.fatigue_penalty.skill_multiplier : 1;
}

export function fatigueSpeedMultiplier(creature: Creature): number {
  return isFatigued(creature) ? getSimConstants().day_night.fatigue_penalty.speed_multiplier : 1;
}
