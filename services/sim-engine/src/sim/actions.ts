import { clamp, type Rng } from "./rng.js";
import { getSimConstants } from "./simConstants.js";
import { ageStageFor, ageWeeksAt } from "./lifecycle.js";
import { fatigueSkillMultiplier, fatigueSpeedMultiplier } from "./needs.js";
import { speedForAgeStage, stepAndReflect, type Medium } from "../world/movement.js";
import { type ZoneName } from "../world/zones.js";
import {
  clearFootprintFromLand,
  ecoZoneAtSim,
  ecoZoneCenterSim,
  isLandSim,
  mediumAtSim,
  pushOrcaOffLand,
} from "../world/landMask.js";
import type { FishField } from "../world/fish.js";
import type { Activity, Creature, SignalRecord, SignalType, Vector2 } from "./types.js";

const MOVING_ACTIONS_WITH_CREATURE_TARGET = new Set([
  "flee",
  "approach",
  "court",
  "hunt",
  "stealth_approach",
  "coordinate_hunt",
]);

const HUNT_ACTIONS = new Set(["hunt", "stealth_approach", "coordinate_hunt"]);
const FORAGE_ACTIONS = new Set(["goto_food", "eat"]);

function zoneCenter(zone: ZoneName): Vector2 {
  return ecoZoneCenterSim(zone);
}

function normalizeAngle(rad: number): number {
  const twoPi = Math.PI * 2;
  let a = rad % twoPi;
  if (a < 0) a += twoPi;
  return a;
}

/** Кратчайший поворот от `from` к `to` в радианах (-π..π). */
function shortestAngleDelta(from: number, to: number): number {
  let d = normalizeAngle(to) - normalizeAngle(from);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function turnHeadingToward(current: number, target: number, maxTurn: number): number {
  const delta = shortestAngleDelta(current, target);
  if (Math.abs(delta) <= maxTurn) return normalizeAngle(target);
  return normalizeAngle(current + Math.sign(delta) * maxTurn);
}

function ensureHeading(creature: Creature, rng: Rng): number {
  if (creature.heading !== undefined) return creature.heading;
  const { x, y } = creature.velocity;
  if (Math.hypot(x, y) > 1e-6) return normalizeAngle(Math.atan2(y, x));
  return rng.range(0, Math.PI * 2);
}

function dirFromHeading(heading: number): Vector2 {
  return { x: Math.cos(heading), y: Math.sin(heading) };
}

/** Стена берега: центр + shore_clearance (halfLength). Orca всегда; penguin только в воде. */
function clearBodyFromLand(creature: Creature, bounds: { width: number; height: number }): void {
  const shore = getSimConstants().movement.shore_clearance_radius_units;
  let r = 0;
  if (creature.species === "orca") {
    r = shore.orca;
  } else if (!isLandSim(creature.pos.x, creature.pos.y)) {
    r = shore.penguin_water;
  } else {
    return;
  }
  const before = creature.pos;
  const onLand = isLandSim(before.x, before.y);
  creature.pos = clearFootprintFromLand(before.x, before.y, r, bounds);
  if (onLand && (creature.pos.x !== before.x || creature.pos.y !== before.y)) {
    creature.velocity = { x: -creature.velocity.x, y: -creature.velocity.y };
  }
}

type Steering = ReturnType<typeof getSimConstants>["movement"]["steering"];

/** Wander продолжает текущий курс: на границе патруля только слегка отклоняется. */
function pickWanderDir(creature: Creature, rng: Rng, steering: Steering): Vector2 {
  let heading = ensureHeading(creature, rng);
  if ((creature.wanderHeadingTicks ?? 0) > 0) {
    creature.wanderHeadingTicks = (creature.wanderHeadingTicks ?? 0) - 1;
  } else {
    heading = normalizeAngle(heading + rng.range(-steering.wander_jitter_rad, steering.wander_jitter_rad));
    creature.wanderHeadingTicks = steering.wander_persistence_ticks;
  }
  creature.heading = heading;
  return dirFromHeading(heading);
}

/**
 * Наблюдаемый режим активности после resolveMovement/resolveActions.
 * `transit_*` выставляется в resolveMovement при смене среды.
 * Awake → never idle (walk/swim by medium); asleep → sleep.
 */
export function deriveActivity(creature: Creature, action: string, currentTick: number): Activity {
  // transit_* держится один тик (transitUntilTick = setTick+1); без until — legacy sticky → сброс.
  if (
    (creature.activity === "transit_in" || creature.activity === "transit_out") &&
    creature.transitUntilTick !== undefined &&
    currentTick < creature.transitUntilTick
  ) {
    return creature.activity;
  }
  if (creature.isAsleep || action === "sleep") return "sleep";
  if (action === "flee") return "flee";
  if (HUNT_ACTIONS.has(action)) return "hunt";
  if (FORAGE_ACTIONS.has(action)) return "forage";
  const medium = mediumAtSim(creature.pos.x, creature.pos.y);
  return medium === "ice" ? "walk" : "swim";
}

/**
 * Шаг 6 тик-пайплайна (А.3): движение к цели действия. `targetPos` — позиция
 * существа-цели для действий, ссылающихся на другую особь (approach, court,
 * hunt, stealth_approach, coordinate_hunt, flee — от которой, наоборот,
 * убегаем).
 * Правило: asleep = still; awake = always moving (wander fallback).
 */
export function resolveMovement(
  creature: Creature,
  action: string,
  zone: ZoneName | undefined,
  targetPos: Vector2 | undefined,
  bounds: { width: number; height: number },
  currentTick: number,
  rng: Rng,
): void {
  const steering = getSimConstants().movement.steering;
  const ageStage = ageStageFor(creature.species, ageWeeksAt(creature.bornAtTick, currentTick));
  const medium = mediumAtSim(creature.pos.x, creature.pos.y);
  // Касатка на земле невозможна — до шага сдвигаем в воду (иначе baseSpeed бросит).
  if (creature.species === "orca" && medium === "ice") {
    creature.pos = pushOrcaOffLand(creature.pos.x, creature.pos.y, bounds);
  }
  const mediumNow: Medium = mediumAtSim(creature.pos.x, creature.pos.y);
  let speed = speedForAgeStage(creature.species, mediumNow === "ice" && creature.species === "orca" ? "water" : mediumNow, ageStage) * fatigueSpeedMultiplier(creature);
  if (creature.species === "orca" && mediumNow === "ice") {
    // Ещё на земле после push — двигаемся как по воде к воде.
    speed = speedForAgeStage(creature.species, "water", ageStage) * fatigueSpeedMultiplier(creature);
  }
  const actionMult = getSimConstants().movement.action_speed_multipliers;
  if (action === "hunt") speed *= actionMult.hunt;
  else if (action === "coordinate_hunt") speed *= actionMult.coordinate_hunt;
  else if (action === "flee") speed *= actionMult.flee;
  else if (action === "stealth_approach") speed *= actionMult.stealth_approach;

  // Asleep = still (XOR with continuous move when awake).
  // Клиренс от льда всё равно нужен: иначе спящая касатка «лежит» на берегу.
  if (action === "sleep" || creature.isAsleep) {
    creature.velocity = { x: 0, y: 0 };
    clearBodyFromLand(creature, bounds);
    creature.zone = ecoZoneAtSim(creature.pos.x, creature.pos.y);
    return;
  }

  let desiredDir: Vector2 | undefined;
  let steeringAsWander = action === "wander";
  if (targetPos && (MOVING_ACTIONS_WITH_CREATURE_TARGET.has(action) || action === "goto_food")) {
    const dx = targetPos.x - creature.pos.x;
    const dy = targetPos.y - creature.pos.y;
    const mag = Math.hypot(dx, dy) || 1;
    desiredDir = action === "flee" ? { x: -dx / mag, y: -dy / mag } : { x: dx / mag, y: dy / mag };
  } else if (action === "wander") {
    desiredDir = pickWanderDir(creature, rng, steering);
  }

  // Awake with no goal vector → force wander at full speed (never velocity 0).
  if (!desiredDir) {
    desiredDir = pickWanderDir(creature, rng, steering);
    steeringAsWander = true;
  }

  let heading = ensureHeading(creature, rng);
  if (!steeringAsWander) {
    const desiredHeading = Math.atan2(desiredDir.y, desiredDir.x);
    heading = turnHeadingToward(heading, desiredHeading, steering.max_turn_rad_per_tick);
    creature.heading = heading;
  }

  if (targetPos && action !== "flee" && !steeringAsWander) {
    const dist = Math.hypot(targetPos.x - creature.pos.x, targetPos.y - creature.pos.y);
    if (dist < steering.arrival_slow_radius_units) {
      // Essentially arrived: keep moving via wander rather than crawling to a stop.
      const arrivedEps = Math.max(2, steering.arrival_slow_radius_units * 0.1);
      if (dist <= arrivedEps) {
        pickWanderDir(creature, rng, steering);
        heading = creature.heading ?? heading;
      } else {
        const factor = Math.max(0.25, dist / steering.arrival_slow_radius_units);
        speed *= factor;
      }
    }
  }

  const velocity = { x: Math.cos(heading) * speed, y: Math.sin(heading) * speed };
  const result = stepAndReflect(creature.pos, velocity, bounds);
  creature.pos = result.position;
  creature.velocity = result.velocity;

  // Клиренс тела от суши: якорь — центр, радиус ≈ визуальный размер спрайта.
  clearBodyFromLand(creature, bounds);

  const mediumAfter: Medium = mediumAtSim(creature.pos.x, creature.pos.y);
  const prevMedium = creature.lastMedium ?? mediumNow;
  if (prevMedium !== mediumAfter) {
    // transit_in = вход в воду; transit_out = выход на лёд.
    creature.activity = mediumAfter === "water" ? "transit_in" : "transit_out";
    creature.transitUntilTick = currentTick + 1;
  }
  creature.lastMedium = mediumAfter;
  creature.zone = ecoZoneAtSim(creature.pos.x, creature.pos.y);
}

/** goto_food/flee/approach/court/hunt/stealth_approach/coordinate_hunt — целевая точка движения. */
export function movementTargetPos(action: string, zone: ZoneName | undefined, target: Creature | undefined): Vector2 | undefined {
  if (MOVING_ACTIONS_WITH_CREATURE_TARGET.has(action)) return target?.pos;
  if (action === "goto_food" && zone) return zoneCenter(zone);
  return undefined;
}

export interface EatResult {
  success: boolean;
  amountConsumed: number;
}

/** Шаг 6: кормёжка пингвина (А.4/А.10) — вероятностная, с влиянием навыка foraging и стадии. */
export function resolveEat(creature: Creature, fishField: FishField, isNight: boolean, currentTick: number, rng: Rng): EatResult {
  const constants = getSimConstants();
  const zone = creature.zone;
  const availability = fishField.availability(zone, isNight);
  if (availability <= 0) return { success: false, amountConsumed: 0 };

  const ageStage = ageStageFor(creature.species, ageWeeksAt(creature.bornAtTick, currentTick));
  const skillMult = constants.skills.outcome_multiplier.base + constants.skills.outcome_multiplier.skill_weight * creature.skills.foraging;
  let pSuccess = constants.foraging.base_success_probability * skillMult * fatigueSkillMultiplier(creature) * availability;
  if (ageStage === "juvenile") pSuccess *= constants.life_stages.juvenile_self_feeding_efficiency;
  pSuccess = clamp(pSuccess, 0, 1);

  if (!rng.bool(pSuccess)) return { success: false, amountConsumed: 0 };

  const consumed = fishField.consume(zone, constants.foraging.meal_fish_density_amount);
  if (consumed <= 0) return { success: false, amountConsumed: 0 };
  creature.needs.hunger = clamp(creature.needs.hunger - constants.foraging.hunger_reduction_per_meal, 0, 1);
  return { success: true, amountConsumed: consumed };
}

export interface HuntOutcome {
  caught: boolean;
  noticedInAdvance: boolean;
  successProbability: number;
}

export interface HuntConditions {
  guarded: boolean;
  coordinated: boolean;
  groupProtected: boolean;
}

/**
 * Касание при охоте = смерть (UX 2026-08-01). Удача А.10 живёт в pre_contact
 * (срыв/flee); здесь всегда caught=true. noticedInAdvance — для сигналов/логов.
 */
export function resolveHunt(orca: Creature, prey: Creature, conditions: HuntConditions, currentTick: number, rng: Rng): HuntOutcome {
  void conditions;
  const noticedInAdvance = rollHuntNotice(orca, prey, currentTick, rng);
  orca.needs.hunger = clamp(orca.needs.hunger - getSimConstants().hunting.hunger_reduction_per_kill, 0, 1);
  return { caught: true, noticedInAdvance, successProbability: 1 };
}

/** P(заметил заранее) — evasion × threat; до контакта → commit flee. */
export function rollHuntNotice(orca: Creature, prey: Creature, _currentTick: number, rng: Rng): boolean {
  const constants = getSimConstants();
  const h = constants.hunting;
  const skillConf = constants.skills.outcome_multiplier;
  const perceivedThreatOfOrca = prey.perceivedStates.get(orca.id)?.perceivedThreat ?? h.prey_threat.baseline;
  const noticeSkillMult = skillConf.base + skillConf.skill_weight * prey.skills.evasion;
  const pNotice = clamp(
    h.notice_in_advance_base_probability * noticeSkillMult * fatigueSkillMultiplier(prey) * (0.5 + perceivedThreatOfOrca),
    0,
    1,
  );
  return rng.bool(pNotice);
}

/** Шаг 6: stealth_approach — сигнал (7.8.2), подавляющий воспринимаемую жертвой угрозу от ЭТОЙ касатки. */
export function resolveStealthApproach(orca: Creature, prey: Creature, currentTick: number): void {
  const constants = getSimConstants();
  const existing = prey.perceivedStates.get(orca.id) ?? {
    perceivedVigor: 0.5,
    perceivedThreat: getSimConstants().hunting.prey_threat.baseline,
    lastSignalTick: -Infinity,
  };
  existing.perceivedThreat *= constants.movement.stealth_approach.perceived_threat_multiplier;
  // Пол не даёт underflow до denormal (pg `real` падает на ~1e-60).
  existing.perceivedThreat = clamp(existing.perceivedThreat, 0.01, 1);
  existing.lastSignalTick = currentTick;
  prey.perceivedStates.set(orca.id, existing);
}

export interface ProvisionResult {
  success: boolean;
  hungerReduced: number;
}

/** Шаг 6 / 7.9: provision — родитель кормит детёныша, успех зависит от навыка parenting. */
export function resolveProvision(parent: Creature, offspring: Creature, rng: Rng): ProvisionResult {
  const constants = getSimConstants();
  const skillConf = constants.skills.outcome_multiplier;
  const pSuccess = clamp(
    constants.hunting.provision_base_success_probability * (skillConf.base + skillConf.skill_weight * parent.skills.parenting),
    0,
    1,
  );
  if (!rng.bool(pSuccess)) return { success: false, hungerReduced: 0 };
  const before = offspring.needs.hunger;
  offspring.needs.hunger = clamp(offspring.needs.hunger - constants.hunting.provision_hunger_reduction, 0, 1);
  return { success: true, hungerReduced: before - offspring.needs.hunger };
}

/** Шаг 6: сигналы display_vigor / alarm_call — создаёт SignalRecord и сдвигает perceivedStates/perceivedZoneThreat получателей, взвешенно доверием (7.8.2, 7.8.4). */
export function resolveSignal(
  sender: Creature,
  type: SignalType,
  zone: ZoneName,
  trueState: number,
  claimedState: number,
  receivers: Creature[],
  currentTick: number,
  resolveWindowTicks: number,
  idFactory: () => string,
): SignalRecord {
  const constants = getSimConstants();
  const shiftPerTrust = constants.signaling.perceived_vigor_shift_per_trust;

  for (const receiver of receivers) {
    const trustEntry = receiver.trust.get(sender.id) ?? {
      trust: constants.signaling.trust.starting_value,
      confirmations: 0,
      disconfirmations: 0,
    };
    receiver.trust.set(sender.id, trustEntry);
    const shift = shiftPerTrust * trustEntry.trust;

    if (type === "display_vigor") {
      const state = receiver.perceivedStates.get(sender.id) ?? { perceivedVigor: trueState, perceivedThreat: 0, lastSignalTick: currentTick };
      state.perceivedVigor = clamp(state.perceivedVigor + shift, 0, 1);
      state.lastSignalTick = currentTick;
      receiver.perceivedStates.set(sender.id, state);
    } else if (type === "alarm_call") {
      const current = receiver.perceivedZoneThreat.get(zone) ?? 0;
      receiver.perceivedZoneThreat.set(zone, clamp(current + shift, 0, 1));
    }
  }

  if (type === "display_vigor") {
    sender.needs.energy = clamp(sender.needs.energy - constants.signaling.display_vigor_cost_pct_energy * sender.needs.energy, 0, 1);
  } else if (type === "alarm_call") {
    sender.needs.energy = clamp(sender.needs.energy - constants.signaling.alarm_call_cost_pct_energy * sender.needs.energy, 0, 1);
  }

  return {
    id: idFactory(),
    senderId: sender.id,
    tick: currentTick,
    type,
    zone,
    trueState,
    claimedState,
    outcome: "pending",
    receivers: receivers.map((r) => r.id),
    resolveByTick: currentTick + resolveWindowTicks,
  };
}

export function resolveSleepToggle(creature: Creature, chosenAction: string): void {
  // Пингвин может спать только на земле (маска DS: континенты + bergs).
  if (chosenAction === "sleep" && creature.species === "penguin") {
    if (!isLandSim(creature.pos.x, creature.pos.y)) {
      creature.isAsleep = false;
      return;
    }
  }
  creature.isAsleep = chosenAction === "sleep";
}
