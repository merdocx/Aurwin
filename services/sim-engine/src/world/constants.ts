import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONSTANTS_PATH = path.resolve(__dirname, "../../../../config/constants.yaml");

/**
 * Читает config/constants.yaml напрямую (тот же паттерн, что и
 * services/db/src/constants.ts) — единый источник правды для чисел
 * симуляции (CLAUDE.md, «Незыблемые правила», п.3), не хардкодятся в коде.
 */
function loadConstants(): Record<string, unknown> {
  return yaml.load(readFileSync(CONSTANTS_PATH, "utf8")) as Record<string, unknown>;
}

/** Разделы `config/constants.yaml`, нужные модулю "Мир" (ТЗ, разделы 6.2, А.10). */
export interface WorldConstants {
  time: {
    visual_tick_seconds: number;
    inner_day_real_hours: number;
  };
  world: {
    map: { width: number; height: number };
    fish_respawn_per_tick: Record<string, number>;
    zones: Record<string, { type: "ice" | "water"; share: number }>;
  };
  movement: {
    water_speed: { penguin: number; orca: number };
    ice_speed: { penguin: number };
    old_age_speed_multiplier: number;
  };
  day_night: {
    perception_radius: {
      penguin: { day: number; night: number };
      orca: { day: number; night: number };
    };
    asleep_perception_multiplier: { penguin: number; orca: number };
    night_fish_availability_multiplier: number;
  };
}

let cached: WorldConstants | undefined;

/** Читает `config/constants.yaml` один раз за процесс (CLAUDE.md, п.3: числа только оттуда). */
export function getWorldConstants(): WorldConstants {
  if (!cached) {
    cached = loadConstants() as unknown as WorldConstants;
  }
  return cached;
}

/** Только для тестов: сбросить кэш, если файл констант подменяется в фикстуре. */
export function resetWorldConstantsCache(): void {
  cached = undefined;
}
