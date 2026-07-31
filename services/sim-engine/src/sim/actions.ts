import { clamp, type Rng } from "./rng.js";
import { getSimConstants } from "./simConstants.js";
import { ageStageFor, ageWeeksAt } from "./lifecycle.js";
import { fatigueSkillMultiplier, fatigueSpeedMultiplier } from "./needs.js";
import { speedForAgeStage, stepAndReflect, type Medium } from "../world/movement.js";
import { buildZoneLayout, zoneAt, type ZoneName } from "../world/zones.js";
import type { FishField } from "../world/fish.js";
import type { Creature, SignalRecord, SignalType, Vector2 } from "./types.js";

const MOVING_ACTIONS_WITH_CREATURE_TARGET = new Set([
  "flee",
  "approach",
  "court",
  "hunt",
  "stealth_approach",
  "coordinate_hunt",
]);

function zoneCenter(zone: ZoneName): Vector2 {
  const z = buildZoneLayout().find((zz) => zz.name === zone);
  if (!z) throw new Error(`zoneCenter: неизвестная зона ${zone}`);
  return { x: (z.x0 + z.x1) / 2, y: (z.y0 + z.y1) / 2 };
}

function mediumOf(zone: ZoneName): Medium {
  return buildZoneLayout().find((z) => z.name === zone)!.type;
}

/**
 * Шаг 6 тик-пайплайна (А.3): движение к цели действия. `targetPos` — позиция
 * существа-цели для действий, ссылающихся на другую особь (approach, court,
 * hunt, stealth_approach, coordinate_hunt, flee — от которой, наоборот,
 * убегаем).
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
  const ageStage = ageStageFor(creature.species, ageWeeksAt(creature.bornAtTick, currentTick));
  const medium = mediumOf(creature.zone);
  let speed = speedForAgeStage(creature.species, medium, ageStage) * fatigueSpeedMultiplier(creature);
  if (action === "stealth_approach") {
    speed *= getSimConstants().movement.stealth_approach.speed_multiplier;
  }

  let dir: Vector2 | undefined;
  if (targetPos && (MOVING_ACTIONS_WITH_CREATURE_TARGET.has(action) || action === "goto_food")) {
    const dx = targetPos.x - creature.pos.x;
    const dy = targetPos.y - creature.pos.y;
    const mag = Math.hypot(dx, dy) || 1;
    dir = action === "flee" ? { x: -dx / mag, y: -dy / mag } : { x: dx / mag, y: dy / mag };
  } else if (action === "wander") {
    const angle = rng.range(0, Math.PI * 2);
    dir = { x: Math.cos(angle), y: Math.sin(angle) };
  }

  if (!dir) {
    creature.velocity = { x: 0, y: 0 };
    return;
  }

  const velocity = { x: dir.x * speed, y: dir.y * speed };
  const result = stepAndReflect(creature.pos, velocity, bounds);
  creature.pos = result.position;
  creature.velocity = result.velocity;
  creature.zone = zoneAt(creature.pos.x, creature.pos.y).name;

  // Касатка физически не может оказаться на льду (нет среды передвижения
  // там, world/movement.ts бросает исключение) — любое действие (включая
  // wander со случайным направлением) может по прямой пересечь границу
  // вода/лёд, поэтому граница здесь — общий предохранитель, а не
  // специфика конкретного действия.
  if (creature.species === "orca" && mediumOf(creature.zone) === "ice") {
    const waterMinX = Math.min(...buildZoneLayout().filter((z) => z.type === "water").map((z) => z.x0));
    creature.pos = { x: waterMinX, y: creature.pos.y };
    creature.velocity = { x: -creature.velocity.x, y: creature.velocity.y };
    creature.zone = zoneAt(creature.pos.x, creature.pos.y).name;
  }
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
 * Шаг 6: вероятностная модель охоты (А.10) со всеми модификаторами +
 * влияние навыков (hunting касатки, evasion жертвы — А.4). `noticedInAdvance`
 * реализует "жертва заметила касатку заранее" через ту же формулу навыка,
 * что и общий P(уклонения) А.4 (`base × (0.6+0.8×evasion)`), домноженную на
 * воспринимаемую жертвой угрозу ОТ ЭТОЙ касатки — так `stealth_approach`
 * (который эту угрозу подавляет, 7.8.2) реально снижает шанс "быть
 * замеченным заранее" при последующей атаке, а не только косметически.
 */
export function resolveHunt(orca: Creature, prey: Creature, conditions: HuntConditions, currentTick: number, rng: Rng): HuntOutcome {
  const constants = getSimConstants();
  const h = constants.hunting;
  const skillConf = constants.skills.outcome_multiplier;
  const preyAgeStage = ageStageFor(prey.species, ageWeeksAt(prey.bornAtTick, currentTick));
  const orcaAgeStage = ageStageFor(orca.species, ageWeeksAt(orca.bornAtTick, currentTick));

  const perceivedThreatOfOrca = prey.perceivedStates.get(orca.id)?.perceivedThreat ?? 0.4;
  const noticeSkillMult = skillConf.base + skillConf.skill_weight * prey.skills.evasion;
  const pNotice = clamp(
    h.notice_in_advance_base_probability * noticeSkillMult * fatigueSkillMultiplier(prey) * (0.5 + perceivedThreatOfOrca),
    0,
    1,
  );
  const noticedInAdvance = rng.bool(pNotice);

  let p = constants.world.base_hunt_success_probability;
  if (preyAgeStage === "juvenile") p *= h.juvenile_prey_multiplier;
  if (preyAgeStage === "old") p *= h.old_prey_multiplier;
  if (conditions.groupProtected) {
    p *= conditions.coordinated
      ? constants.kinship.coordinate_hunt.group_defense_multiplier_with_coordination
      : constants.kinship.coordinate_hunt.group_defense_multiplier_without_coordination;
  }
  if (noticedInAdvance) p *= h.noticed_in_advance_multiplier;
  if (orca.needs.hunger >= h.hungry_hunter_hunger_threshold) p *= h.hungry_hunter_multiplier;
  if (conditions.guarded) p *= constants.kinship.guard_offspring.offspring_hunt_success_multiplier;

  let skillMult = skillConf.base + skillConf.skill_weight * orca.skills.hunting;
  skillMult *= fatigueSkillMultiplier(orca);
  if (orcaAgeStage === "juvenile") skillMult *= constants.life_stages.juvenile_self_feeding_efficiency;

  const successProbability = clamp(p * skillMult, 0, 1);
  const caught = rng.bool(successProbability);
  if (caught) {
    orca.needs.hunger = clamp(orca.needs.hunger - h.hunger_reduction_per_kill, 0, 1);
  }
  return { caught, noticedInAdvance, successProbability };
}

/** Шаг 6: stealth_approach — сигнал (7.8.2), подавляющий воспринимаемую жертвой угрозу от ЭТОЙ касатки. */
export function resolveStealthApproach(orca: Creature, prey: Creature, currentTick: number): void {
  const constants = getSimConstants();
  const existing = prey.perceivedStates.get(orca.id) ?? { perceivedVigor: 0.5, perceivedThreat: 0.4, lastSignalTick: -Infinity };
  existing.perceivedThreat *= constants.movement.stealth_approach.perceived_threat_multiplier;
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
  creature.isAsleep = chosenAction === "sleep";
}
