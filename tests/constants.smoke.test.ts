import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import yaml from "js-yaml";

// Smoke-тест фазы 1: config/constants.yaml существует, парсится и содержит
// ВСЕ константы из таблицы А.9 (docs/AURWIN_TZ.md). Балансировочные значения
// сюда не зашиваются — только проверка структуры файла как единого источника
// правды (CLAUDE.md, «Незыблемые правила», п.3).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const constantsPath = path.resolve(__dirname, "../config/constants.yaml");

function loadConstants(): Record<string, unknown> {
  const raw = readFileSync(constantsPath, "utf8");
  return yaml.load(raw) as Record<string, unknown>;
}

function get(obj: unknown, dottedPath: string): unknown {
  return dottedPath
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined,
      obj,
    );
}

// Один путь на каждую строку таблицы А.9 (52 константы).
const EXPECTED_PATHS = [
  "time.visual_tick_seconds",
  "time.biological_clock_speedup",
  "time.inner_day_real_hours",
  "time.snapshot_interval_ticks",
  "population.genesis.penguins",
  "population.genesis.orcas",
  "population.alert_thresholds.penguins.min",
  "population.alert_thresholds.penguins.max",
  "population.alert_thresholds.orcas.min",
  "population.alert_thresholds.orcas.max",
  "population.reintroduction.penguins_alert_below",
  "population.reintroduction.orcas_alert_below",
  "population.reintroduction.reintroduce_at",
  "reflection.trait_delta_clamp",
  "reflection.trait_lifetime_corridor",
  "reflection.weight_delta_clamp",
  "reflection.weight_lifetime_corridor",
  "reflection.event_debounce_hours",
  "reflection.event_global_limit_per_hour",
  "reflection.event_global_limit_per_day",
  "reflection.background_interval_hours",
  "reflection.llm_daily_budget_usd",
  "reflection.llm_budget_alert_multiplier",
  "memory.episodic_limit.penguin",
  "memory.episodic_limit.orca",
  "memory.significance_decay_per_day.penguin",
  "memory.significance_decay_per_day.orca",
  "memory.core_memory_significance_threshold",
  "utility_ai.noise_epsilon_max",
  "world.map.width",
  "world.map.height",
  "world.fish_respawn_per_tick.north_bay",
  "world.fish_respawn_per_tick.south_shallows",
  "world.base_hunt_success_probability",
  "social.friendship.threshold",
  "social.friendship.decay_below",
  "life_stages.penguin_weeks.juvenile",
  "life_stages.penguin_weeks.adult",
  "life_stages.penguin_weeks.old",
  "life_stages.orca_weeks.juvenile",
  "life_stages.orca_weeks.adult",
  "life_stages.orca_weeks.old",
  "life_stages.juvenile_self_feeding_efficiency",
  "movement.water_speed.penguin",
  "movement.water_speed.orca",
  "movement.stealth_approach.speed_multiplier",
  "movement.stealth_approach.perceived_threat_multiplier",
  "decision_log.sampled_creatures_count",
  "decision_log.ttl_days",
  "skills.growth_per_success",
  "skills.cap",
  "skills.decay_per_day",
  "skills.outcome_multiplier.base",
  "skills.outcome_multiplier.skill_weight",
  "skills.social_learning.witness_multiplier",
  "skills.social_learning.bonded_friend_multiplier",
  "signaling.display_vigor_cost_pct_energy",
  "signaling.alarm_call_cost_pct_energy",
  "signaling.perceived_vigor_shift_per_trust",
  "signaling.perceived_state_decay_per_tick",
  "signaling.trust.gain_on_confirmation",
  "signaling.trust.loss_on_refutation",
  "signaling.trust.starting_value",
  "signaling.expressiveness_trait_range",
  "kinship.offspring_guard_radius_units",
  "kinship.guard_offspring.offspring_hunt_success_multiplier",
  "kinship.guard_offspring.parent_visibility_increase",
  "kinship.coordinate_hunt.group_defense_multiplier_without_coordination",
  "kinship.coordinate_hunt.group_defense_multiplier_with_coordination",
  "kinship.kinship_check_depth_generations",
  "day_night.perception_radius.penguin.day",
  "day_night.perception_radius.penguin.night",
  "day_night.perception_radius.orca.day",
  "day_night.perception_radius.orca.night",
  "day_night.asleep_perception_multiplier.penguin",
  "day_night.asleep_perception_multiplier.orca",
  "day_night.night_fish_availability_multiplier",
  "day_night.sleep_energy_recovery_multiplier",
  "day_night.chronotype_trait_range",
  "day_night.sleep_pressure.gain_per_day_awake",
  "day_night.sleep_pressure.loss_per_day_asleep",
  "day_night.fatigue_penalty.sleep_pressure_threshold",
  "day_night.fatigue_penalty.skill_multiplier",
  "day_night.fatigue_penalty.speed_multiplier",
  "authority.formula.age_weight",
  "authority.formula.profile_skill_weight",
  "authority.transmission_weight.base",
  "authority.transmission_weight.authority_weight",
  "authority.recompute_interval",
];

describe("config/constants.yaml", () => {
  it("парсится как валидный YAML-объект", () => {
    const constants = loadConstants();
    expect(constants).toBeTypeOf("object");
    expect(constants).not.toBeNull();
  });

  it.each(EXPECTED_PATHS)("содержит ключ %s (табл. А.9)", (dottedPath) => {
    const constants = loadConstants();
    const value = get(constants, dottedPath);
    expect(value, `ожидался ключ "${dottedPath}"`).toBeDefined();
  });
});
