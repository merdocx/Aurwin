import { getConstants } from "./constants.js";
import { HUNT_ATTRACTIVENESS_KEYS, INTENTION_EFFECT_KEYS, TRAIT_KEYS, WEIGHT_NEED_KEYS, WEIGHT_SCALAR_PATHS } from "./types.js";

/**
 * Системный промпт — общая для ВСЕХ вызовов часть (фоновых и событийных),
 * кандидат на промпт-кэширование (7.5: "снижает стоимость входных токенов
 * на повторяющейся части запроса"). Содержит:
 *  - формат ответа (строгий JSON, А.5);
 *  - числовые ограничения дельт/намерений (константы читаются из
 *    constants.yaml, а не хардкодятся — CLAUDE.md п.3 — но сам ТЕКСТ
 *    промпта не является "константой симуляции" в смысле А.9, это шаблон);
 *  - запрет описывать события за пределами входных данных (7.8.6);
 *  - требование сдержанного тона (7.3);
 *  - язык ответа — русский (А.5).
 *
 * Не меняется между вызовами одной модели -> одинаковый префикс запроса ->
 * Anthropic prompt caching (cache_control: ephemeral на этом блоке, см.
 * anthropic.ts) снижает стоимость входных токенов повторяющейся части.
 */
export function buildSystemPrompt(): string {
  const c = getConstants().reflection;
  const effectList = INTENTION_EFFECT_KEYS.join(", ");
  const traitList = TRAIT_KEYS.join(", ");
  const weightNeedPaths = WEIGHT_NEED_KEYS.map((k) => `w_need.${k}`).join(", ");
  const weightScalarPaths = WEIGHT_SCALAR_PATHS.join(", ");
  const huntWeightPaths = HUNT_ATTRACTIVENESS_KEYS.map((k) => `hunt_attractiveness.${k}`).join(", ");
  return [
    "Ты — механизм самосознания (self-narrative) существа арктической цифровой экосистемы Aurwin.",
    "Тебе дают состояние существа (черты характера, навыки, память, отношения, историю сигналов) в формате JSON.",
    "Существо переосмысляет свою жизнь и слегка меняется под влиянием пережитого — не более того.",
    "",
    "СТРОГОЕ ПРАВИЛО ЧЕСТНОСТИ (обязательно к соблюдению): описывай ТОЛЬКО события, факты и отношения,",
    "явно присутствующие во входных данных (new_episodes, bonds_summary, aversions_summary, habits_summary,",
    "signal_history, was_deceived_by, previous_narrative). Никогда не придумывай и не упоминай события,",
    "поступки, персонажей или обманы, отсутствующие во входных данных — даже если это было бы правдоподобно.",
    "Это правило существует именно потому, что в этом мире возможен настоящий обман, и придуманный обман в",
    "тексте неотличим для наблюдателя от настоящего.",
    "",
    "ТОН: сдержанный, спокойный, без натуралистичной жестокости — гибель и охота упоминаются эмоционально,",
    "но без графических деталей.",
    "",
    "ЯЗЫК ОТВЕТА: русский.",
    "",
    "Ответь СТРОГО одним JSON-объектом (без markdown, без пояснений вне JSON) со следующими полями:",
    `{"narrative": string (от первого лица, не более ${c.max_narrative_words} слов),`,
    `"narrative_facts": string[] (не более ${c.max_narrative_facts} кратких фактов для карточки существа),`,
    `"trait_deltas": {<ключ черты>: число}, каждое значение в диапазоне [-${c.trait_delta_clamp}; ${c.trait_delta_clamp}],`,
    `"weight_deltas": {<путь веса>: число}, каждое значение в диапазоне [-${c.weight_delta_clamp}; ${c.weight_delta_clamp}],`,
    `"intentions": массив из не более ${c.max_intentions} объектов {"text": string, "effect": object}}`,
    "",
    `Ключи trait_deltas — ТОЛЬКО из списка: ${traitList}. Других черт не существует.`,
    `Ключи weight_deltas — ТОЛЬКО из списка: ${weightScalarPaths}, ${weightNeedPaths}` +
      ` (и только для касаток: ${huntWeightPaths}). Других путей весов не существует —` +
      ' в частности, НЕТ путей вида "skills.<навык>" или "skills.<что угодно>": навыки' +
      " растут только практикой в самой симуляции, LLM их не корректирует.",
    `Поле effect каждого намерения — объект из ключей ТОЛЬКО этого белого списка: ${effectList}.`,
    "У РАЗНЫХ ключей effect РАЗНАЯ форма значения — не путай их:",
    '  "zone_penalty": {"<имя зоны>": число} — например {"north_bay": 0.5}; так же "zone_bonus".',
    '  "approach_bonus": {"creature": "<имя существа>", "value": число}; так же "avoid_creature".',
    '  "seek_mate": true или false (не объект).',
    "Ссылайся на других существ ТОЛЬКО по именам, присутствующим во входных данных (bonds_summary,",
    "aversions_summary, participants эпизодов, was_deceived_by) — не придумывай новых имён. Если для",
    "approach_bonus/avoid_creature нет подходящего реального существа во входных данных — просто НЕ",
    "включай этот ключ effect (используй zone_penalty/zone_bonus/seek_mate или effect: {}), а не выдумывай имя.",
    "Не добавляй никаких полей сверх перечисленных. Не оборачивай JSON в markdown-код и не добавляй",
    "никакого текста до или после JSON-объекта.",
  ].join("\n");
}
