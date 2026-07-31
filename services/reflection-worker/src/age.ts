import { getConstants } from "./constants.js";

export type Species = "penguin" | "orca";
export type AgeStage = "juvenile" | "adult" | "old";

/**
 * 1 реальные сутки = 1 внутренняя неделя (6.2) — то же соответствие, что и
 * services/sim-engine/src/sim/time.ts и services/api-gateway/src/age.ts
 * (каждый сервис дублирует эту маленькую чистую формулу вместо кросс-
 * сервисного импорта sim-engine — см. ops/DEVIATIONS.md, фаза 6).
 */
export function ageWeeksAt(bornAtTick: number, currentTick: number, visualTickSeconds: number): number {
  const realDays = ((currentTick - bornAtTick) * visualTickSeconds) / 86400;
  return realDays;
}

/** Дублирует services/sim-engine/src/sim/lifecycle.ts::ageStageFor. */
export function ageStageFor(species: Species, ageWeeks: number): AgeStage {
  const { life_stages } = getConstants();
  const stages = species === "penguin" ? life_stages.penguin_weeks : life_stages.orca_weeks;
  if (ageWeeks < stages.juvenile) return "juvenile";
  if (ageWeeks < stages.adult) return "adult";
  return "old";
}
