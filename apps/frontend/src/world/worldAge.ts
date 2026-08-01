/** Возраст мира в реальных сутках (как sim ticksToRealDays). */
export function worldAgeDays(tick: number, tickSeconds: number): number {
  if (tickSeconds <= 0) return 0;
  return (tick * tickSeconds) / 86400;
}

/** Короткая русская формулировка для шапки. */
export function formatWorldAge(tick: number, tickSeconds: number): string {
  const days = Math.floor(worldAgeDays(tick, tickSeconds));
  if (days <= 0) return "мир живёт менее суток";
  if (days === 1) return "мир живёт 1 сутки";
  if (days >= 2 && days <= 4) return `мир живёт ${days} суток`;
  return `мир живёт ${days} суток`;
}
