import { getWorldConstants } from "./constants.js";

export type Phase = "day" | "night";
export type Species = "penguin" | "orca";

/**
 * Суточный цикл (7.10, А.10): внутренние сутки ≈ 3.4 реальных часа,
 * светлое и тёмное время — по половине. Считается в тиках визуального
 * тайминга (world.map живёт на этом же тике — А.3 разделяет визуальный тик
 * и ускоренные биочасы, но восход/закат — часть "физики" мира, а не
 * биологии конкретного существа, поэтому идёт по реальному времени
 * напрямую через time.inner_day_real_hours).
 */
export class DayNightCycle {
  private tickCount = 0;

  /** Сколько тиков занимают одни внутренние сутки. */
  ticksPerDay(): number {
    const { visual_tick_seconds, inner_day_real_hours } = getWorldConstants().time;
    return Math.round((inner_day_real_hours * 3600) / visual_tick_seconds);
  }

  tick(): void {
    this.tickCount += 1;
  }

  get currentTick(): number {
    return this.tickCount;
  }

  /** Позиция внутри текущих суток, 0..ticksPerDay()-1. */
  private tickOfDay(): number {
    const total = this.ticksPerDay();
    return ((this.tickCount % total) + total) % total;
  }

  phase(): Phase {
    return this.tickOfDay() < this.ticksPerDay() / 2 ? "day" : "night";
  }

  isNight(): boolean {
    return this.phase() === "night";
  }
}

/**
 * Радиус восприятия существа с учётом суток и сна (А.10): дневное/ночное
 * базовое значение по виду, дополнительно урезанное множителем для спящих
 * (полусон у касаток — ×0.5, а не полное отключение).
 */
export function perceptionRadius(
  species: Species,
  phase: Phase,
  isAsleep: boolean,
): number {
  const constants = getWorldConstants().day_night;
  const base = constants.perception_radius[species][phase];
  if (!isAsleep) return base;
  return base * constants.asleep_perception_multiplier[species];
}
