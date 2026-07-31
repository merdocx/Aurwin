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
 */
export class NameGenerator {
  private counters = new Map<"penguin" | "orca", number>();

  nameFor(species: "penguin" | "orca"): string {
    const dict = DICTIONARIES[species];
    const index = this.counters.get(species) ?? 0;
    this.counters.set(species, index + 1);
    const base = dict[index % dict.length];
    const cycle = Math.floor(index / dict.length);
    return cycle === 0 ? base : `${base}-${cycle + 1}`;
  }
}
