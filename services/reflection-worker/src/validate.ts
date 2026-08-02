import { getConstants } from "./constants.js";
import {
  HUNT_ATTRACTIVENESS_KEYS,
  INTENTION_EFFECT_KEYS,
  TRAIT_KEYS,
  WEIGHT_NEED_KEYS,
  WEIGHT_SCALAR_PATHS,
  type IntentionEffectKey,
  type TraitKey,
} from "./types.js";

export interface ResolvedIntentionEffect {
  zone_penalty?: Record<string, number>;
  zone_bonus?: Record<string, number>;
  approach_bonus?: { creatureId: string; value: number };
  avoid_creature?: { creatureId: string; value: number };
  seek_mate?: boolean;
  prefer_zone?: string;
  avoid_zone?: string;
  hunt_with?: string;
}

export interface ResolvedIntention {
  text: string;
  effect: ResolvedIntentionEffect;
}

export interface ValidatedReflection {
  narrative: string;
  narrativeFacts: string[];
  traitDeltas: Partial<Record<TraitKey, number>>;
  weightDeltas: Record<string, number>;
  intentions: ResolvedIntention[];
}

export interface ValidationContext {
  /** Известные зоны (world.zones из constants.yaml) — для zone_penalty/zone_bonus. */
  knownZones: Set<string>;
  /** name -> id всех существ, упомянутых во входных данных этого запроса (bonds/aversions/эпизоды/сигналы) + сам субъект. */
  nameToId: Map<string, string>;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  value?: ValidatedReflection;
}

function fail(errors: string[]): ValidationResult {
  return { ok: false, errors };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Честность повествования (7.8.6, А.5): грубая, но механическая проверка —
 * любое собственное имя (капитализированное слово НЕ в начале предложения),
 * встреченное в narrative/narrative_facts, обязано соответствовать (по
 * префиксу, без учёта регистра — переживает русское склонение) какому-то
 * имени, реально присутствовавшему во входных данных запроса. Не может
 * заменить полноценную семантическую проверку (это NLP-задача, не решаемая
 * чистым кодом без второго вызова LLM-судьи, что удвоило бы стоимость и
 * противоречило бы бюджетным целям 7.6) — но ловит самый разрушительный
 * случай: полностью выдуманного персонажа, которого нет ни в bonds_summary,
 * ни в episodes.participants, ни в signal_history (см. ops/DEVIATIONS.md,
 * фаза 6).
 */
/**
 * Русское склонение меняет ХВОСТ короткого имени, а не только добавляет
 * суффикс ("Тика" -> "Тикой", "Пика" -> "Пикой", "Лоня" -> "Лоней") — при
 * жёстком префиксе фиксированной длины (4 символа) реальные имена в
 * косвенном падеже ошибочно распознавались как выдуманные (наблюдалось в
 * боевом прогоне против реального Anthropic API, см. ops/DEVIATIONS.md,
 * фаза 6). Длина сравниваемого префикса — от более короткого слова минус
 * запас под падежное окончание (обычно 1-3 буквы у русских имён).
 */
function sharesStem(a: string, b: string): boolean {
  const minLen = Math.min(a.length, b.length);
  const prefixLen = Math.max(2, minLen - (minLen <= 4 ? 1 : minLen <= 6 ? 2 : 3));
  return a.slice(0, prefixLen).toLowerCase() === b.slice(0, prefixLen).toLowerCase();
}

export function findUngroundedNames(text: string, knownNames: Set<string>): string[] {
  const known = [...knownNames];
  const ungrounded: string[] = [];
  // Капитализированное кириллическое слово, которому предшествует строчная
  // буква/запятая/пробел после запятой (т.е. НЕ начало предложения) —
  // эвристика для отсечения обычных заглавных букв в начале фразы.
  const pattern = /(?:[а-яё],?\s+)([А-ЯЁ][а-яё]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const token = match[1];
    const grounded = known.some((name) => sharesStem(token, name));
    if (!grounded) ungrounded.push(token);
  }
  return [...new Set(ungrounded)];
}

/**
 * Синонимы зон, которые модель иногда подставляет вместо канонических имён
 * из constants.yaml (наблюдалось: "deep_water" вместо open_water). Не расширяет
 * карту мира — только нормализует к whitelist перед проверкой.
 */
const ZONE_ALIASES: Record<string, string> = {
  deep_water: "open_water",
  deepwater: "open_water",
  ocean: "open_water",
  sea: "open_water",
  openwater: "open_water",
  colony: "main_ice",
  ice: "main_ice",
  ice_floe: "main_ice",
  bay: "north_bay",
  shallows: "south_shallows",
  refuge: "far_ice",
};

export function canonicalizeZone(zone: string, knownZones: Set<string>): string | undefined {
  if (knownZones.has(zone)) return zone;
  const aliased = ZONE_ALIASES[zone.toLowerCase()];
  if (aliased && knownZones.has(aliased)) return aliased;
  return undefined;
}

function resolveCreatureRef(
  raw: unknown,
  ctx: ValidationContext,
): { creatureId: string; value: number } | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;
  const name = obj.creature;
  const value = obj.value;
  if (typeof name !== "string" || !isFiniteNumber(value)) return undefined;
  const id = ctx.nameToId.get(name);
  if (!id) return undefined;
  return { creatureId: id, value };
}

function resolveCreatureId(raw: unknown, ctx: ValidationContext): string | undefined {
  return typeof raw === "string" ? ctx.nameToId.get(raw) : undefined;
}

/**
 * Модели (даже при явном запрете в системном промпте) иногда оборачивают
 * JSON в markdown code fence (```json ... ```) — реально наблюдалось в
 * боевом прогоне против Anthropic API (см. ops/DEVIATIONS.md, фаза 6).
 * Снимаем обёртку до парсинга, а не ослабляем сам контракт.
 */
function stripMarkdownFence(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

/** Валидация выхода LLM-рефлексии по контракту А.5 перед применением. */
export function validateReflectionResponse(raw: string, ctx: ValidationContext): ValidationResult {
  const constants = getConstants().reflection;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripMarkdownFence(raw));
  } catch {
    return fail(["invalid_json"]);
  }
  if (typeof parsed !== "object" || parsed === null) return fail(["not_an_object"]);
  const obj = parsed as Record<string, unknown>;
  const errors: string[] = [];

  // narrative
  if (typeof obj.narrative !== "string" || obj.narrative.trim().length === 0) {
    errors.push("narrative: не строка или пусто");
  } else if (wordCount(obj.narrative) > constants.max_narrative_words) {
    errors.push(`narrative: превышен лимит слов (${constants.max_narrative_words})`);
  }

  // narrative_facts
  let narrativeFacts: string[] = [];
  if (!Array.isArray(obj.narrative_facts) || !obj.narrative_facts.every((f) => typeof f === "string")) {
    errors.push("narrative_facts: не массив строк");
  } else if (obj.narrative_facts.length > constants.max_narrative_facts) {
    errors.push(`narrative_facts: превышен лимит фактов (${constants.max_narrative_facts})`);
  } else {
    narrativeFacts = obj.narrative_facts as string[];
  }

  // trait_deltas
  const traitDeltas: Partial<Record<TraitKey, number>> = {};
  if (typeof obj.trait_deltas !== "object" || obj.trait_deltas === null) {
    errors.push("trait_deltas: не объект");
  } else {
    for (const [key, value] of Object.entries(obj.trait_deltas as Record<string, unknown>)) {
      if (!(TRAIT_KEYS as readonly string[]).includes(key)) {
        errors.push(`trait_deltas: неизвестная черта "${key}"`);
        continue;
      }
      if (!isFiniteNumber(value) || Math.abs(value) > constants.trait_delta_clamp) {
        errors.push(`trait_deltas.${key}: вне диапазона [-${constants.trait_delta_clamp}; ${constants.trait_delta_clamp}]`);
        continue;
      }
      traitDeltas[key as TraitKey] = value;
    }
  }

  // weight_deltas
  const weightDeltas: Record<string, number> = {};
  const validWeightPath = (path: string): boolean => {
    if ((WEIGHT_SCALAR_PATHS as readonly string[]).includes(path)) return true;
    const segments = path.split(".");
    if (segments.length !== 2) return false;
    if (segments[0] === "w_need") return (WEIGHT_NEED_KEYS as readonly string[]).includes(segments[1]);
    if (segments[0] === "hunt_attractiveness") return (HUNT_ATTRACTIVENESS_KEYS as readonly string[]).includes(segments[1]);
    return false;
  };
  if (typeof obj.weight_deltas !== "object" || obj.weight_deltas === null) {
    errors.push("weight_deltas: не объект");
  } else {
    for (const [path, value] of Object.entries(obj.weight_deltas as Record<string, unknown>)) {
      if (!validWeightPath(path)) {
        errors.push(`weight_deltas: неизвестный путь веса "${path}"`);
        continue;
      }
      if (!isFiniteNumber(value) || Math.abs(value) > constants.weight_delta_clamp) {
        errors.push(`weight_deltas.${path}: вне диапазона [-${constants.weight_delta_clamp}; ${constants.weight_delta_clamp}]`);
        continue;
      }
      weightDeltas[path] = value;
    }
  }

  // intentions
  const intentions: ResolvedIntention[] = [];
  if (!Array.isArray(obj.intentions)) {
    errors.push("intentions: не массив");
  } else if (obj.intentions.length > constants.max_intentions) {
    errors.push(`intentions: превышен лимит (${constants.max_intentions})`);
  } else {
    for (const raw of obj.intentions) {
      if (typeof raw !== "object" || raw === null) {
        errors.push("intentions: элемент не объект");
        continue;
      }
      const item = raw as Record<string, unknown>;
      if (typeof item.text !== "string" || item.text.trim().length === 0) {
        errors.push("intentions[].text: не строка или пусто");
        continue;
      }
      if (typeof item.effect !== "object" || item.effect === null) {
        errors.push("intentions[].effect: не объект");
        continue;
      }
      const rawEffect = item.effect as Record<string, unknown>;
      const effectKeys = Object.keys(rawEffect);
      // Неизвестные ключи (часто голый `value`) — вырезаем, не валим весь ответ.
      const knownKeys = effectKeys.filter((k) => (INTENTION_EFFECT_KEYS as readonly string[]).includes(k));

      const effect: ResolvedIntentionEffect = {};
      let intentionValid = true;

      for (const key of knownKeys as IntentionEffectKey[]) {
        if (key === "zone_penalty" || key === "zone_bonus") {
          const zones = rawEffect[key];
          if (typeof zones !== "object" || zones === null) {
            errors.push(`intentions[].effect.${key}: не объект`);
            intentionValid = false;
            break;
          }
          const resolvedZones: Record<string, number> = {};
          for (const [zone, value] of Object.entries(zones as Record<string, unknown>)) {
            const canonical = canonicalizeZone(zone, ctx.knownZones);
            if (!canonical || !isFiniteNumber(value) || Math.abs(value) > 1) {
              errors.push(`intentions[].effect.${key}: недопустимая зона/значение "${zone}"`);
              intentionValid = false;
              break;
            }
            resolvedZones[canonical] = value;
          }
          if (!intentionValid) break;
          effect[key] = resolvedZones;
        } else if (key === "approach_bonus" || key === "avoid_creature") {
          // Битая ссылка (мертвый/неизвестный id) — вырезаем ключ, намерение оставляем.
          const resolved = resolveCreatureRef(rawEffect[key], ctx);
          if (resolved) effect[key] = resolved;
        } else if (key === "prefer_zone" || key === "avoid_zone") {
          const rawZone = rawEffect[key];
          const canonical = typeof rawZone === "string" ? canonicalizeZone(rawZone, ctx.knownZones) : undefined;
          if (!canonical) {
            errors.push(`intentions[].effect.${key}: недопустимая зона`);
            intentionValid = false;
            break;
          }
          effect[key] = canonical;
        } else if (key === "hunt_with") {
          const creatureId = resolveCreatureId(rawEffect[key], ctx);
          if (creatureId) effect.hunt_with = creatureId;
        } else if (key === "seek_mate") {
          if (typeof rawEffect[key] !== "boolean") {
            errors.push("intentions[].effect.seek_mate: не boolean");
            intentionValid = false;
            break;
          }
          effect.seek_mate = rawEffect[key] as boolean;
        }
      }

      if (intentionValid) intentions.push({ text: item.text, effect });
    }
  }

  // Честность повествования (7.8.6) — только если базовая форма уже валидна,
  // чтобы не путать структурные ошибки с честностью в одном отчёте об ошибке.
  // ВАЖНО: каждая строка (narrative и КАЖДЫЙ отдельный факт) проверяется
  // ОТДЕЛЬНО, а не склеивается в одну через простой пробел — иначе конец
  // одного факта без точки, за которым сразу начинается следующий факт с
  // заглавной буквы, ложно выглядел бы как "имя в середине предложения"
  // (наблюдалось в боевом прогоне против реального Anthropic API, где
  // обычные слова вроде "Живёт"/"Пока" на границе двух фактов ошибочно
  // флагались как выдуманные имена — см. ops/DEVIATIONS.md, фаза 6).
  if (errors.length === 0) {
    const narrative = typeof obj.narrative === "string" ? obj.narrative : "";
    const knownNames = new Set(ctx.nameToId.keys());
    const ungrounded = [narrative, ...narrativeFacts].flatMap((text) => findUngroundedNames(text, knownNames));
    if (ungrounded.length > 0) {
      errors.push(`narrative: упомянуты неизвестные имена (возможная выдумка, 7.8.6): ${[...new Set(ungrounded)].join(", ")}`);
    }
  }

  if (errors.length > 0) return fail(errors);

  return {
    ok: true,
    errors: [],
    value: {
      narrative: obj.narrative as string,
      narrativeFacts,
      traitDeltas,
      weightDeltas,
      intentions,
    },
  };
}
