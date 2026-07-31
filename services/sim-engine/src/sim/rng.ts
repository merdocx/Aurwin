/**
 * Детерминированный генератор случайных чисел (mulberry32) — нужен для
 * воспроизводимости `npm run simulate -- --seed N` (флаг --seed из
 * требований фазы 4) и для юнит-тестов utility AI ("детерминированность при
 * фикс. seed" — А.8, план тестирования, п.1). Никогда не используем
 * Math.random() в логике симуляции.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Избегаем состояния 0 (даёт вырожденную короткую орбиту).
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  /** Следующее число с плавающей точкой в [0, 1). */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Равномерно в [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Целое в [min, max] включительно. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** true с вероятностью p (0..1). */
  bool(p: number): boolean {
    return this.next() < p;
  }

  /** Случайный элемент массива (бросает исключение на пустом массиве). */
  choice<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("Rng.choice: пустой массив");
    return arr[this.int(0, arr.length - 1)];
  }

  /** Нормальное распределение (Box-Muller), среднее mean, стандартное отклонение stddev. */
  gaussian(mean = 0, stddev = 1): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return mean + z * stddev;
  }

  /** Малый шум ε для utility AI, амплитуда до maxAmplitude (А.4). */
  noise(maxAmplitude: number): number {
    return this.range(-maxAmplitude, maxAmplitude);
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
