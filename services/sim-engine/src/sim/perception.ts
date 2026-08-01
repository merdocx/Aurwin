import { clamp, type Rng } from "./rng.js";
import type { SpatialGrid, IndexedPoint } from "../world/spatialIndex.js";
import { perceptionRadius, type Phase } from "../world/dayNight.js";
import { getSimConstants } from "./simConstants.js";
import { ageStageFor, ageWeeksAt } from "./lifecycle.js";
import { trueVigor } from "./vigor.js";
import { applyEmotionDelta, EMOTION_DELTAS } from "./emotion.js";
import { innateSpeciesThreat } from "./instincts.js";
import type { Creature } from "./types.js";

/**
 * Дальность зрения (диск, без FOV-конуса): день/ночь + множитель сна.
 * Единая точка для sense / flee / hunt / witnesses / display_vigor.
 */
export function visionRange(creature: Creature, phase: Phase): number {
  return perceptionRadius(creature.species, phase, creature.isAsleep);
}

/** @deprecated alias — предпочитай visionRange */
export const perceptionRadiusFor = visionRange;

/**
 * Дальность слуха (alarm_call / пробуждение) — диск, не зависит от суток/сна.
 */
export function hearingRange(creature: Creature): number {
  return getSimConstants().day_night.hearing_radius[creature.species];
}

/**
 * Шаг 4 тик-пайплайна (А.3): sense(). Возвращает список реально видимых
 * соседей (в радиусе восприятия, зависящем от суток/сна) и заводит
 * БАЗОВУЮ запись в perceivedStates для впервые увиденных субъектов —
 * "по умолчанию приблизительна (шум восприятия)" (7.8.1). Существующие
 * записи (уже сдвинутые сигналами) здесь не перезаписываются — их меняют
 * reinforceVisiblePredatorThreat / resolveHunt / decayPerceivedStates.
 */
export function sense(
  observer: Creature,
  spatialIndex: SpatialGrid<IndexedPoint>,
  byId: Map<string, Creature>,
  phase: Phase,
  currentTick: number,
  rng: Rng,
): Creature[] {
  const radius = visionRange(observer, phase);
  const nearby = spatialIndex.queryRadius(observer.pos.x, observer.pos.y, radius, observer.id);
  const visible: Creature[] = [];
  const baselineThreat = getSimConstants().hunting.prey_threat.baseline;

  for (const point of nearby) {
    const subject = byId.get(point.id);
    if (!subject) continue;
    visible.push(subject);

    if (!observer.perceivedStates.has(subject.id)) {
      const ageStage = ageStageFor(subject.species, ageWeeksAt(subject.bornAtTick, currentTick));
      const noise = rng.gaussian(0, 0.08);
      const innateThreat = innateSpeciesThreat(observer, subject.species);
      const isPredator = innateThreat > 0.2;
      const startThreat = isPredator ? Math.max(baselineThreat, innateThreat) : innateThreat;
      observer.perceivedStates.set(subject.id, {
        perceivedVigor: clamp(trueVigor(subject, ageStage) + noise, 0, 1),
        perceivedThreat: startThreat,
        lastSignalTick: -Infinity,
      });
      if (isPredator) {
        applyEmotionDelta(observer, EMOTION_DELTAS.see_orca);
      }
    }
  }

  return visible;
}

/** Пока касатка в радиусе — floor threat (иначе decay съедает страх). */
export function reinforceVisiblePredatorThreat(observer: Creature, visible: Creature[]): void {
  if (observer.species !== "penguin") return;
  const floor = getSimConstants().hunting.prey_threat.visible_floor;
  for (const subject of visible) {
    if (subject.species !== "orca") continue;
    const state = observer.perceivedStates.get(subject.id);
    if (!state) continue;
    if (state.perceivedThreat < floor) state.perceivedThreat = floor;
  }
}

/** После попытки охоты / контакта — поднять threat жертвы к этой касатке. */
export function bumpPreyThreatOfOrca(prey: Creature, orca: Creature, level: number): void {
  const existing = prey.perceivedStates.get(orca.id) ?? {
    perceivedVigor: 0.5,
    perceivedThreat: getSimConstants().hunting.prey_threat.baseline,
    lastSignalTick: -Infinity,
  };
  existing.perceivedThreat = Math.min(1, Math.max(existing.perceivedThreat, level));
  prey.perceivedStates.set(orca.id, existing);
}

/**
 * Шаг 12 тик-пайплайна (А.3): воспринимаемое состояние стягивается к
 * истинной оценке без подкрепления сигналом — обман недолговечен (7.8.1).
 * Threat к касатке decay'ится только когда она НЕ в visibleIds.
 */
export function decayPerceivedStates(
  observer: Creature,
  trueVigorLookup: (subjectId: string) => number | undefined,
  visibleIds?: Set<string>,
): void {
  const decayRate = getSimConstants().signaling.perceived_state_decay_per_tick;
  for (const [subjectId, state] of observer.perceivedStates) {
    const trueValue = trueVigorLookup(subjectId);
    if (trueValue !== undefined) {
      state.perceivedVigor += (trueValue - state.perceivedVigor) * decayRate;
    }
    if (!visibleIds?.has(subjectId)) {
      state.perceivedThreat += (0 - state.perceivedThreat) * decayRate;
      if (state.perceivedThreat < 0.001) state.perceivedThreat = 0;
    }
  }

  const zoneDecayRate = getSimConstants().memory.zone_threat_decay_per_tick;
  for (const [zone, threat] of observer.perceivedZoneThreat) {
    const next = threat * (1 - zoneDecayRate);
    if (next < 0.01) {
      observer.perceivedZoneThreat.delete(zone);
    } else {
      observer.perceivedZoneThreat.set(zone, next);
    }
  }
}
