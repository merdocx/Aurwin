/**
 * Имена существ — БЕЗ LLM (А.5: "Генерация имён — без LLM"). Заранее
 * подготовленный словарь (~200 имён на вид), различимых на слух между
 * видами; при исчерпании — числовой суффикс. Словарь строится один раз при
 * загрузке модуля перебором фиксированных слоговых пар (детерминированно,
 * не зависит от seed симуляции — это статичный словарь, а не случайная
 * генерация).
 */

const PENGUIN_SYLLABLES_1 = [
  "Пи", "Ти", "Ко", "Ло", "Ми", "Ню", "Со", "То", "Фи", "Ша",
  "Э", "Юр", "Я", "Бо", "Ве", "Ги", "Де", "Же", "За", "Ику",
] as const;
const PENGUIN_SYLLABLES_2 = [
  "нго", "ка", "ня", "ло", "си", "то", "фи", "ша", "ри", "ну",
  "ва", "зя", "ки", "ло", "ми",
] as const;

const ORCA_SYLLABLES_1 = [
  "Гро", "Кра", "Дра", "Бра", "Тро", "Вра", "Мор", "Скар", "Гар", "Тар",
  "Крон", "Дорн", "Барг", "Норд", "Ворт",
] as const;
const ORCA_SYLLABLES_2 = [
  "гар", "дан", "рок", "вал", "нор", "мар", "гор", "дур", "вор", "тан",
  "хан", "рун",
] as const;

function buildDictionary(s1: readonly string[], s2: readonly string[], minSize: number): string[] {
  const names = new Set<string>();
  for (const a of s1) {
    for (const b of s2) {
      names.add(a + b.toLowerCase());
      if (names.size >= minSize) return Array.from(names);
    }
  }
  return Array.from(names);
}

const PENGUIN_NAMES = buildDictionary(PENGUIN_SYLLABLES_1, PENGUIN_SYLLABLES_2, 200);
const ORCA_NAMES = buildDictionary(ORCA_SYLLABLES_1, ORCA_SYLLABLES_2, 200);

const DICTIONARIES = { penguin: PENGUIN_NAMES, orca: ORCA_NAMES } as const;

/**
 * Выдаёт имена по порядку из словаря вида; после исчерпания добавляет
 * числовой суффикс и продолжает цикл по словарю (А.5).
 * После restore нужно вызвать seedOccupied, иначе счётчики с нуля
 * повторят уже занятые имена.
 */
export class NameGenerator {
  private counters = new Map<"penguin" | "orca", number>();
  private occupied = new Set<string>();

  /** Пометить уже живущие (и недавние) имена занятыми; сдвинуть counters. */
  seedOccupied(entries: Array<{ name: string; species: "penguin" | "orca" }>): void {
    for (const { name, species } of entries) {
      this.occupied.add(name);
      const dict = DICTIONARIES[species];
      const idx = dict.indexOf(name);
      if (idx >= 0) {
        const cur = this.counters.get(species) ?? 0;
        if (idx + 1 > cur) this.counters.set(species, idx + 1);
      }
      // Суффиксные имена вида «Пика-2» — только в occupied.
    }
  }

  nameFor(species: "penguin" | "orca"): string {
    const dict = DICTIONARIES[species];
    for (let guard = 0; guard < dict.length * 20; guard++) {
      const index = this.counters.get(species) ?? 0;
      this.counters.set(species, index + 1);
      const base = dict[index % dict.length];
      const cycle = Math.floor(index / dict.length);
      const candidate = cycle === 0 ? base : `${base}-${cycle + 1}`;
      if (!this.occupied.has(candidate)) {
        this.occupied.add(candidate);
        return candidate;
      }
    }
    // Крайний случай: уникальный суффикс от счётчика.
    const fallback = `${dict[0]}-${Date.now()}`;
    this.occupied.add(fallback);
    return fallback;
  }
}
