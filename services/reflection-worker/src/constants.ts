import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONSTANTS_PATH = path.resolve(__dirname, "../../../config/constants.yaml");

/**
 * Единый источник правды для констант рефлексии (CLAUDE.md, «Незыблемые
 * правила», п.3) — только тот срез config/constants.yaml, который нужен
 * reflection-worker. Читает файл независимо от sim-engine/db (тот же
 * принцип, что и services/sim-engine/src/sim/simConstants.ts и
 * services/db/src/constants.ts — каждый сервис копирует свой Dockerfile-
 * контекст без соседних services/*, поэтому кросс-сервисный импорт констант
 * не используется, см. ops/DEVIATIONS.md, фаза 6).
 */
export interface ReflectionConstants {
  trait_delta_clamp: number;
  trait_lifetime_corridor: number;
  weight_delta_clamp: number;
  weight_lifetime_corridor: number;
  event_debounce_hours: number;
  event_global_limit_per_hour: number;
  event_global_limit_per_day: number;
  background_interval_hours: number;
  llm_daily_budget_usd: number;
  llm_budget_alert_multiplier: number;
  models: { background: string; event: string };
  model_pricing_usd_per_million_tokens: Record<string, { input: number; output: number }>;
  max_narrative_words: number;
  max_intentions: number;
  max_narrative_facts: number;
}

export interface WorkerConstants {
  reflection: ReflectionConstants;
  world: { zones: Record<string, { type: "ice" | "water"; share: number }> };
  memory: {
    episodic_limit: { penguin: number; orca: number };
  };
  signaling: {
    signal_honesty_tolerance: number;
  };
  time: {
    visual_tick_seconds: number;
  };
  life_stages: {
    penguin_weeks: { juvenile: number; adult: number; old: number };
    orca_weeks: { juvenile: number; adult: number; old: number };
  };
}

let cached: WorkerConstants | undefined;

export function getConstants(): WorkerConstants {
  if (!cached) {
    cached = yaml.load(readFileSync(CONSTANTS_PATH, "utf8")) as unknown as WorkerConstants;
  }
  return cached;
}

/** Только для тестов. */
export function resetConstantsCache(): void {
  cached = undefined;
}
