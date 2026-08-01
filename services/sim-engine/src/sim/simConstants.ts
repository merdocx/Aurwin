import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONSTANTS_PATH = path.resolve(__dirname, "../../../../config/constants.yaml");

/**
 * Полный набор разделов config/constants.yaml, нужных модулю "Жизнь" (фаза 4).
 * Читает тот же файл, что и world/constants.ts (services/db/src/constants.ts
 * задаёт паттерн), но не ограничивается подмножеством для мира — сюда входят
 * все разделы, которыми пользуется utility AI, жизненный цикл, сигналы,
 * родство и сон (CLAUDE.md, «Незыблемые правила», п.3: числа только отсюда).
 */
export interface SimConstants {
  time: {
    visual_tick_seconds: number;
    biological_clock_speedup: number;
    inner_day_real_hours: number;
    snapshot_interval_ticks: number;
  };
  population: {
    genesis: { penguins: number; orcas: number };
    alert_thresholds: {
      penguins: { min: number; max: number };
      orcas: { min: number; max: number };
    };
    reintroduction: {
      penguins_alert_below: number;
      orcas_alert_below: number;
      reintroduce_at: number;
    };
    genesis_initial_needs: { hunger: number; energy: number; social: number; sleep_pressure: number };
    genesis_initial_emotion: { valence: number; arousal: number };
  };
  reflection: {
    trait_delta_clamp: number;
    trait_lifetime_corridor: number;
    weight_delta_clamp: number;
    weight_lifetime_corridor: number;
    event_debounce_hours: number;
    event_global_limit_per_hour: number;
    event_global_limit_per_day: number;
    background_interval_hours: number;
  };
  memory: {
    episodic_limit: { penguin: number; orca: number };
    significance_decay_per_day: { penguin: number; orca: number };
    core_memory_significance_threshold: number;
  };
  utility_ai: {
    noise_epsilon_max: number;
    weight_defaults: {
      w_need: { hunger: number; energy: number; social: number; sleep: number };
      w_trait: number;
      w_skill: number;
      w_habit: number;
    };
    intention_effects: {
      zone_preference: number;
      hunt_with_bonus: number;
    };
  };
  world: {
    map: { width: number; height: number };
    fish_respawn_per_tick: Record<string, number>;
    base_hunt_success_probability: number;
    zones: Record<string, { type: "ice" | "water"; share: number }>;
  };
  social: {
    friendship: { threshold: number; decay_below: number };
    bond_growth_per_tick_within_radius: number;
    bond_decay_per_tick_apart: number;
    bond_proximity_radius_units: number;
    aversion_decay_per_day: number;
  };
  life_stages: {
    penguin_weeks: { juvenile: number; adult: number; old: number };
    orca_weeks: { juvenile: number; adult: number; old: number };
    juvenile_self_feeding_efficiency: number;
  };
  movement: {
    water_speed: { penguin: number; orca: number };
    ice_speed: { penguin: number };
    old_age_speed_multiplier: number;
    action_speed_multipliers: {
      hunt: number;
      coordinate_hunt: number;
      flee: number;
      stealth_approach: number;
    };
    body_radius_units: { penguin: number; orca: number };
    stealth_approach: { speed_multiplier: number; perceived_threat_multiplier: number };
    steering: {
      max_turn_rad_per_tick: number;
      wander_persistence_ticks: number;
      wander_jitter_rad: number;
      action_commit_ticks: number;
      action_hysteresis_utility: number;
      arrival_slow_radius_units: number;
    };
    separation: {
      penguin_radius_units: number;
      orca_radius_units: number;
      iterations: number;
      max_nudge_units: number;
      position_nudge_multiplier: number;
      heading_nudge_weight: number;
    };
  };
  decision_log: { sampled_creatures_count: number; ttl_days: number };
  skills: {
    genesis_initial_max: number;
    habit_moving_average_alpha: number;
    growth_per_success: number;
    cap: number;
    decay_per_day: number;
    outcome_multiplier: { base: number; skill_weight: number };
    social_learning: { witness_multiplier: number; bonded_friend_multiplier: number };
  };
  signaling: {
    display_vigor_cost_pct_energy: number;
    alarm_call_cost_pct_energy: number;
    alarm_call_visibility_multiplier: number;
    alarm_call_visibility_duration_ticks: number;
    perceived_vigor_shift_per_trust: number;
    perceived_state_decay_per_tick: number;
    trust: { gain_on_confirmation: number; loss_on_refutation: number; starting_value: number };
    expressiveness_trait_range: [number, number];
  };
  kinship: {
    offspring_guard_radius_units: number;
    guard_offspring: { offspring_hunt_success_multiplier: number; parent_visibility_multiplier: number };
    coordinate_hunt: {
      group_defense_multiplier_without_coordination: number;
      group_defense_multiplier_with_coordination: number;
    };
    kinship_check_depth_generations: number;
  };
  day_night: {
    perception_radius: {
      penguin: { day: number; night: number };
      orca: { day: number; night: number };
    };
    hearing_radius: { penguin: number; orca: number };
    asleep_perception_multiplier: { penguin: number; orca: number };
    night_fish_availability_multiplier: number;
    sleep_energy_recovery_multiplier: number;
    chronotype_trait_range: [number, number];
    sleep_pressure: { gain_per_day_awake: number; loss_per_day_asleep: number };
    fatigue_penalty: { sleep_pressure_threshold: number; skill_multiplier: number; speed_multiplier: number };
  };
  needs_rates: {
    hunger_gain_per_day: number;
    energy_loss_active_per_day: number;
    energy_gain_rest_per_day: number;
    social_gain_per_day_alone: number;
    starvation_death_after_hours: number;
  };
  reproduction: {
    max_hunger_to_mate: number;
    min_bond_strength_to_mate: number;
    attempt_probability_per_tick: number;
    cooldown_inner_days: number;
    trait_mutation_stddev: number;
    chronotype_mutation_stddev: number;
    expressiveness_mutation_stddev: number;
    culture_inherit: {
      habit_weight: number;
      habit_noise_amplitude: number;
      weights_blend: number;
      skill_seed: number;
    };
  };
  foraging: {
    base_success_probability: number;
    meal_fish_density_amount: number;
    hunger_reduction_per_meal: number;
  };
  hunting: {
    prey_threat: {
      baseline: number;
      visible_floor: number;
      hunt_bump: number;
      flee_proximity_weight: number;
      social_suppress: number;
    };
    contact_radius_units: number;
    pre_contact: {
      approach_band_extra_units: number;
      defense_nudge_units: number;
      break_cooldown_ticks: number;
    };
    reattempt_cooldown_real_minutes: number;
    juvenile_prey_multiplier: number;
    old_prey_multiplier: number;
    noticed_in_advance_multiplier: number;
    hungry_hunter_multiplier: number;
    hungry_hunter_hunger_threshold: number;
    notice_in_advance_base_probability: number;
    attractiveness_weight_defaults: { w_vigor: number; w_dist: number; w_group: number; w_stage: number };
    juvenile_stage_bonus: number;
    adult_stage_bonus: number;
    hunger_reduction_per_kill: number;
    provision_base_success_probability: number;
    provision_hunger_reduction: number;
  };
  episode_significance: Record<string, number>;
  authority: {
    formula: { age_weight: number; profile_skill_weight: number };
    transmission_weight: { base: number; authority_weight: number };
  };
}

let cached: SimConstants | undefined;

export function getSimConstants(): SimConstants {
  if (!cached) {
    cached = yaml.load(readFileSync(CONSTANTS_PATH, "utf8")) as unknown as SimConstants;
  }
  return cached;
}

/** Только для тестов. */
export function resetSimConstantsCache(): void {
  cached = undefined;
}
