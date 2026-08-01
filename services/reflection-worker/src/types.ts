/**
 * Контракт LLM-рефлексии (ТЗ А.5) + типы БД-строк, которыми оперирует
 * reflection-worker. Не импортирует типы sim-engine (тот же принцип
 * независимости сервисов, что и в constants.ts/pool.ts) — схема здесь
 * отражает ТОЛЬКО то, что реально лежит в колонках Postgres (snake_case).
 */

export const TRAIT_KEYS = ["courage", "curiosity", "sociability", "aggression", "caution", "expressiveness"] as const;
export type TraitKey = (typeof TRAIT_KEYS)[number];
export type Traits = Record<TraitKey, number>;

/** Пути весов, которые разрешено адресовать в weight_deltas (А.2/7.7, механизм 4). */
export const WEIGHT_NEED_KEYS = ["hunger", "energy", "social", "sleep"] as const;
export const HUNT_ATTRACTIVENESS_KEYS = ["w_vigor", "w_dist", "w_group", "w_stage"] as const;
/** w_need.<key> добавляются отдельно в validate.ts — это только "плоские" пути. */
export const WEIGHT_SCALAR_PATHS = ["w_trait", "w_skill", "w_habit"] as const;

/** Белый список машинно-применимых эффектов намерения (А.5). */
export const INTENTION_EFFECT_KEYS = ["zone_penalty", "zone_bonus", "approach_bonus", "avoid_creature", "seek_mate", "prefer_zone", "avoid_zone", "hunt_with"] as const;
export type IntentionEffectKey = (typeof INTENTION_EFFECT_KEYS)[number];

export type ReflectionKind = "background" | "event";

/** Строка `creatures`, урезанная до полей, нужных построению запроса А.5 и применению результата. */
export interface CreatureRow {
  id: string;
  species: "penguin" | "orca";
  name: string;
  born_at_tick: string | number;
  died_at_tick: string | number | null;
  traits: Traits;
  traits_birth: Traits;
  skills: Record<string, number>;
  habits: Record<string, number>;
  weights: Record<string, unknown>;
  weights_birth: Record<string, unknown>;
  narrative: string | null;
  narrative_facts: string[] | null;
  is_asleep: boolean;
  last_reflection_at: string | number | null;
}

export interface EpisodeRow {
  id: string;
  creature_id: string;
  tick: string | number;
  type: string;
  participants: string[];
  significance: number;
  created_at: string;
  learned_from: string | null;
  transmission_depth: number;
}

export interface BondSummary {
  name: string;
  kind: "friend" | "mate";
  strength: number;
}

export interface AversionSummary {
  name: string;
  strength: number;
  since: string;
}

export interface SignalHistoryEntry {
  type: string;
  tick: number;
  honest: boolean;
  outcome: "pending" | "confirmed" | "disconfirmed";
  note: string;
}

export interface DeceivedByEntry {
  name: string;
  type: string;
  times: number;
}

export interface NewEpisodeForPrompt {
  type: string;
  who: string;
  context: string;
  witnessed: "лично" | "от сородичей";
}

/** А.5 — вход (user-часть промпта). */
export interface ReflectionRequestPayload {
  creature: {
    species: "penguin" | "orca";
    name: string;
    age_weeks: number;
    stage: "juvenile" | "adult" | "old";
    traits: Traits;
    skills: Record<string, number>;
  };
  previous_narrative: string;
  new_episodes: NewEpisodeForPrompt[];
  bonds_summary: BondSummary[];
  aversions_summary: AversionSummary[];
  habits_summary: Record<string, number>;
  signal_history: SignalHistoryEntry[];
  was_deceived_by: DeceivedByEntry[];
  reflection_kind: ReflectionKind;
}

export interface IntentionEffect {
  zone_penalty?: Record<string, number>;
  zone_bonus?: Record<string, number>;
  approach_bonus?: { creature: string; value: number };
  avoid_creature?: { creature: string; value: number };
  seek_mate?: boolean;
  prefer_zone?: string;
  avoid_zone?: string;
  hunt_with?: string;
}

export interface Intention {
  text: string;
  effect: IntentionEffect;
}

/** А.5 — выход (сырое, невалидированное). */
export interface ReflectionResponsePayload {
  narrative: string;
  narrative_facts: string[];
  trait_deltas: Partial<Record<TraitKey, number>>;
  weight_deltas: Record<string, number>;
  intentions: Intention[];
}

/** Кандидат на рефлексию, отобранный queue.ts. */
export interface ReflectionCandidate {
  creatureId: string;
  kind: ReflectionKind;
  /** id эпизодов, слитых в этот вызов (event) — пусто для background. */
  mergedEpisodeIds: string[];
}
