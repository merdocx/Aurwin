import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONSTANTS_PATH = path.resolve(__dirname, "../../../config/constants.yaml");

/**
 * Подмножество config/constants.yaml, нужное api-gateway (CLAUDE.md, п.3:
 * числа только отсюда, не хардкодить). Тот же паттерн дублирования
 * загрузчика, что и в sim-engine/services/db (см. world/constants.ts).
 */
export interface GatewayConstants {
  time: { visual_tick_seconds: number; inner_day_real_hours: number };
  world: {
    map: { width: number; height: number };
    zones: Record<string, { type: "ice" | "water"; share: number }>;
  };
  life_stages: {
    penguin_weeks: { juvenile: number; adult: number; old: number };
    orca_weeks: { juvenile: number; adult: number; old: number };
  };
  social: { friendship: { threshold: number } };
  api: {
    rest_rate_limit_per_minute: number;
    social_graph_cache_seconds: number;
    ws_max_connections_per_ip: number;
    ws_idle_timeout_minutes: number;
    ws_max_total_connections: number;
  };
}

let cached: GatewayConstants | undefined;

export function getConstants(): GatewayConstants {
  if (!cached) {
    cached = yaml.load(readFileSync(CONSTANTS_PATH, "utf8")) as unknown as GatewayConstants;
  }
  return cached;
}

/** Только для тестов. */
export function resetConstantsCache(): void {
  cached = undefined;
}
