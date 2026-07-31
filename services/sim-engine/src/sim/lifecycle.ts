import { getSimConstants } from "./simConstants.js";
import { realDaysToTicks, ticksToInternalWeeks } from "./time.js";
import type { AgeStage, Species } from "./types.js";

function stageWeeks(species: Species): { juvenile: number; adult: number; old: number } {
  const { life_stages } = getSimConstants();
  return species === "penguin" ? life_stages.penguin_weeks : life_stages.orca_weeks;
}

/** Возраст существа во внутренних неделях (А.10) на заданный тик. */
export function ageWeeksAt(bornAtTick: number, currentTick: number): number {
  return ticksToInternalWeeks(currentTick - bornAtTick);
}

/**
 * Возрастная стадия по А.10: `juvenile` — [0, juvenile), `adult` —
 * [juvenile, adult), `old` — [adult, +inf) (гарантированная смерть —
 * отдельная вероятностная проверка в `oldAgeDeathProbabilityPerTick`, а не
 * жёсткая граница здесь).
 */
export function ageStageFor(species: Species, ageWeeks: number): AgeStage {
  const { juvenile, adult } = stageWeeks(species);
  if (ageWeeks < juvenile) return "juvenile";
  if (ageWeeks < adult) return "adult";
  return "old";
}

export function maxAgeWeeksFor(species: Species): number {
  return stageWeeks(species).old;
}

export function oldStageStartWeeksFor(species: Species): number {
  return stageWeeks(species).adult;
}

/**
 * Вероятность смерти от старости ЗА ОДИН ТИК: растёт линейно от 0 в начале
 * стадии "старый" до гарантированной (1) на верхней границе ожидаемой max
 * продолжительности (А.10). Линейный per-week hazard пересчитывается в
 * per-tick вероятность так, чтобы совокупная вероятность за неделю
 * совпадала с per-week hazard (1 внутренняя неделя = 1 реальные сутки, 6.2).
 */
export function oldAgeDeathProbabilityPerTick(species: Species, ageWeeks: number): number {
  const oldStart = oldStageStartWeeksFor(species);
  const max = maxAgeWeeksFor(species);
  if (ageWeeks < oldStart) return 0;
  if (ageWeeks >= max) return 1;
  const hazardPerWeek = (ageWeeks - oldStart) / (max - oldStart);
  const ticksPerWeek = realDaysToTicks(1);
  return 1 - Math.pow(1 - hazardPerWeek, 1 / ticksPerWeek);
}
