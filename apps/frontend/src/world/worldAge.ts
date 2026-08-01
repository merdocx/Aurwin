/**
 * Возраст мира во внутренних (игровых) сутках — как dayNight.ticksPerDay:
 * ticksPerDay = round(inner_day_real_hours * 3600 / tick_seconds).
 */
export function worldAgeInnerDays(
  tick: number,
  tickSeconds: number,
  innerDayRealHours: number,
): number {
  if (tickSeconds <= 0 || innerDayRealHours <= 0) return 0;
  const ticksPerDay = Math.round((innerDayRealHours * 3600) / tickSeconds);
  if (ticksPerDay <= 0) return 0;
  return tick / ticksPerDay;
}

/** Короткая русская формулировка для шапки (игровые дни, не реальное время). */
export function formatWorldAge(
  tick: number,
  tickSeconds: number,
  innerDayRealHours: number,
): string {
  const days = Math.floor(worldAgeInnerDays(tick, tickSeconds, innerDayRealHours));
  if (days <= 0) return "день 0";
  if (days === 1) return "день 1";
  return `день ${days}`;
}
