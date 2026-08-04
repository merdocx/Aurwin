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

// Один путь на каждую строку таблицы А.9, плюс несколько добавленных в фазах
// 2-3 констант вне табл. А.9 дословно (обоснование — ops/DEVIATIONS.md).
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
  "population.genesis_initial_needs.hunger",
  "population.genesis_initial_needs.energy",
  "population.genesis_initial_needs.social",
  "population.genesis_initial_needs.sleep_pressure",
  "population.genesis_initial_emotion.valence",
  "population.genesis_initial_emotion.arousal",
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
  "world.zones.far_ice.type",
  "world.zones.far_ice.share",
  "world.zones.main_ice.type",
  "world.zones.main_ice.share",
  "world.zones.north_bay.type",
  "world.zones.north_bay.share",
  "world.zones.south_shallows.type",
  "world.zones.south_shallows.share",
  "world.zones.open_water.type",
  "world.zones.open_water.share",
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
  "movement.ice_speed.penguin",
  "movement.old_age_speed_multiplier",
  "movement.stealth_approach.speed_multiplier",
  "movement.stealth_approach.perceived_threat_multiplier",
  "movement.separation.penguin_radius_units",
  "movement.separation.orca_radius_units",
  "movement.separation.iterations",
  "movement.separation.max_nudge_units",
  "movement.steering.max_turn_rad_per_tick",
  "movement.steering.wander_persistence_ticks",
  "movement.steering.wander_jitter_rad",
  "movement.steering.action_commit_ticks",
  "movement.steering.action_hysteresis_utility",
  "movement.steering.arrival_slow_radius_units",
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
  "kinship.guard_offspring.parent_visibility_multiplier",
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
  // Ретенция данных (А.2, абзац "ПОЛИТИКА РЕТЕНЦИИ") — вне табл. А.9, добавлено
  // в фазе 2 для соблюдения CLAUDE.md п.3 (единый источник правды для констант).
  "retention.episodes_days_after_death",
  "retention.world_events_full_days",
  "retention.reflections_audit_days",
  "retention.signals_full_days",
  // Фаза 4 «Жизнь» — константы вне табл. А.9 дословно, необходимые для
  // реализации 7.4/7.7/7.8/7.9/7.10 (обоснование — ops/DEVIATIONS.md).
  "social.bond_growth_per_tick_within_radius",
  "social.bond_growth_per_tick_affiliation",
  "social.bond_decay_per_tick_apart",
  "social.bond_proximity_radius_units",
  "social.aversion_decay_per_day",
  "utility_ai.weight_defaults.w_need.hunger",
  "utility_ai.weight_defaults.w_need.energy",
  "utility_ai.weight_defaults.w_need.social",
  "utility_ai.weight_defaults.w_need.sleep",
  "utility_ai.weight_defaults.w_trait",
  "utility_ai.weight_defaults.w_skill",
  "utility_ai.weight_defaults.w_habit",
  "skills.genesis_initial_max",
  "skills.habit_moving_average_alpha",
  "signaling.alarm_call_visibility_multiplier",
  "signaling.alarm_call_visibility_duration_ticks",
  "needs_rates.hunger_gain_per_day",
  "needs_rates.energy_loss_active_per_day",
  "needs_rates.energy_gain_rest_per_day",
  "needs_rates.social_gain_per_day_alone",
  "needs_rates.starvation_death_after_hours",
  "reproduction.max_hunger_to_mate",
  "reproduction.min_bond_strength_to_mate",
  "reproduction.attempt_probability_per_tick",
  "reproduction.cooldown_inner_days",
  "reproduction.trait_mutation_stddev",
  "reproduction.chronotype_mutation_stddev",
  "reproduction.expressiveness_mutation_stddev",
  "reproduction.culture_inherit.habit_weight",
  "reproduction.culture_inherit.skill_seed",
  "reproduction.culture_inherit.instinct_parent_overlay",
  "reproduction.culture_inherit.zone_threat_seed",
  "reproduction.culture_inherit.aversion_seed",
  "memory.zone_threat_decay_per_tick",
  "instincts.penguin.species_affect.orca.threat",
  "instincts.orca.species_affect.penguin.value",
  "instincts.penguin.need_drive.hunger_seek_food",
  "instincts.orca.need_drive.hunger_seek_prey",
  "hunting.contact_radius_units",
  "hunting.juvenile_prey_multiplier",
  "hunting.old_prey_multiplier",
  "hunting.noticed_in_advance_multiplier",
  "hunting.hungry_hunter_multiplier",
  "hunting.hungry_hunter_hunger_threshold",
  "hunting.notice_in_advance_base_probability",
  "hunting.attractiveness_weight_defaults.w_vigor",
  "hunting.attractiveness_weight_defaults.w_dist",
  "hunting.attractiveness_weight_defaults.w_group",
  "hunting.attractiveness_weight_defaults.w_stage",
  "hunting.juvenile_stage_bonus",
  "hunting.adult_stage_bonus",
  "hunting.hunger_reduction_per_kill",
  "hunting.provision_base_success_probability",
  "hunting.provision_hunger_reduction",
  "foraging.base_success_probability",
  "foraging.meal_fish_density_amount",
  "foraging.hunger_reduction_per_meal",
  "episode_significance.friend_died",
  "episode_significance.hunt_success",
  "episode_significance.hunt_attempt_survived_by_prey",
  "episode_significance.hunt_attempt_failed_by_hunter",
  "episode_significance.birth",
  "episode_significance.bond_formed",
  "episode_significance.bond_broken",
  "episode_significance.matured",
  "episode_significance.grew_old",
  "episode_significance.signal_disconfirmed_against_me",
  "episode_significance.woken_by_alarm",
  // Фаза 5 «Наблюдение» — лимиты публичного API (А.6), вне табл. А.9
  // дословно (обоснование — ops/DEVIATIONS.md).
  "api.rest_rate_limit_per_minute",
  "api.social_graph_cache_seconds",
  "api.ws_max_connections_per_ip",
  "api.ws_idle_timeout_minutes",
  "api.ws_max_total_connections",
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
