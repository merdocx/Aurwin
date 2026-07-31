import { getSimConstants } from "./simConstants.js";

/**
 * Перевод визуальных тиков в реальные секунды/сутки и во внутренние недели
 * жизни существа (6.2: "1 реальные сутки ≈ 1 внутренняя неделя", то есть
 * `biological_clock_speedup` (×7) — это то, НАСКОЛЬКО быстрее внутренние
 * сутки идут относительно реальных (7 внутренних суток = 1 реальная неделя
 * укладывается в 1 реальный день => внутренние сутки ≈ inner_day_real_hours
 * реальных часов); а численно 1 внутренняя НЕДЕЛЯ = 1 реальные СУТКИ, то
 * есть перевод тиков в недели идёт напрямую через реальное время, без
 * повторного умножения на speedup (иначе получилось бы двойное ускорение).
 */
export function ticksToRealSeconds(ticks: number): number {
  return ticks * getSimConstants().time.visual_tick_seconds;
}

export function ticksToRealDays(ticks: number): number {
  return ticksToRealSeconds(ticks) / 86400;
}

/** 1 реальные сутки = 1 внутренняя неделя (6.2) — прямое соответствие. */
export function ticksToInternalWeeks(ticks: number): number {
  return ticksToRealDays(ticks);
}

export function ticksToInternalDays(ticks: number): number {
  return ticksToInternalWeeks(ticks) * 7;
}

export function realHoursToTicks(hours: number): number {
  return (hours * 3600) / getSimConstants().time.visual_tick_seconds;
}

export function realDaysToTicks(days: number): number {
  return (days * 86400) / getSimConstants().time.visual_tick_seconds;
}
