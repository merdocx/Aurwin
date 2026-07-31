import { clamp, type Rng } from "./rng.js";
import type { SpatialGrid, IndexedPoint } from "../world/spatialIndex.js";
import { perceptionRadius, type Phase } from "../world/dayNight.js";
import { getSimConstants } from "./simConstants.js";
import { ageStageFor, ageWeeksAt } from "./lifecycle.js";
import { trueVigor } from "./vigor.js";
import type { Creature } from "./types.js";

export function perceptionRadiusFor(creature: Creature, phase: Phase): number {
  return perceptionRadius(creature.species, phase, creature.isAsleep);
}

/**
 * Шаг 4 тик-пайплайна (А.3): sense(). Возвращает список реально видимых
 * соседей (в радиусе восприятия, зависящем от суток/сна) и заводит
 * БАЗОВУЮ запись в perceivedStates для впервые увиденных субъектов —
 * "по умолчанию приблизительна (шум восприятия)" (7.8.1). Существующие
 * записи (уже сдвинутые сигналами) здесь не перезаписываются — их меняют
 * resolveActions() (сигналы) и decayPerceivedStates() (затухание).
 */
export function sense(
  observer: Creature,
  spatialIndex: SpatialGrid<IndexedPoint>,
  byId: Map<string, Creature>,
  phase: Phase,
  currentTick: number,
  rng: Rng,
): Creature[] {
  const radius = perceptionRadiusFor(observer, phase);
  const nearby = spatialIndex.queryRadius(observer.pos.x, observer.pos.y, radius, observer.id);
  const visible: Creature[] = [];

  for (const point of nearby) {
    const subject = byId.get(point.id);
    if (!subject) continue;
    visible.push(subject);

    if (!observer.perceivedStates.has(subject.id)) {
      const ageStage = ageStageFor(subject.species, ageWeeksAt(subject.bornAtTick, currentTick));
      const noise = rng.gaussian(0, 0.08);
      // Базовая воспринимаемая угроза (7.8.1: "приблизительна... по
      // умолчанию"): для пингвина, впервые заметившего касатку, разумный
      // умолчательный ориентир — "хищник рядом, но не факт, что охотится
      // именно сейчас" (0.4), а не 0 — иначе flee/alarm_call никогда не
      // получили бы стартовой полезности до первого сигнала. Дальше
      // фактическая охота/stealth_approach сдвигают это значение точнее
      // (resolveActions/detectEvents, шаги 6-7 А.3).
      const baselineThreat = observer.species === "penguin" && subject.species === "orca" ? 0.4 : 0;
      observer.perceivedStates.set(subject.id, {
        perceivedVigor: clamp(trueVigor(subject, ageStage) + noise, 0, 1),
        perceivedThreat: baselineThreat,
        lastSignalTick: -Infinity,
      });
    }
  }

  return visible;
}

/**
 * Шаг 12 тик-пайплайна (А.3): воспринимаемое состояние стягивается к
 * истинной оценке без подкрепления сигналом — обман недолговечен (7.8.1).
 * `trueVigorLookup` — функция получения истинной бодрости субъекта (нужна
 * извне, т.к. Creature субъекта не хранится внутри perceivedStates).
 */
export function decayPerceivedStates(
  observer: Creature,
  trueVigorLookup: (subjectId: string) => number | undefined,
): void {
  const decayRate = getSimConstants().signaling.perceived_state_decay_per_tick;
  for (const [subjectId, state] of observer.perceivedStates) {
    const trueValue = trueVigorLookup(subjectId);
    if (trueValue !== undefined) {
      state.perceivedVigor += (trueValue - state.perceivedVigor) * decayRate;
    }
    state.perceivedThreat += (0 - state.perceivedThreat) * decayRate;
  }

  const zoneDecayRate = 0.15; // А.2: "затухание 15%/тик - быстрее, чем у perceived_states"
  for (const [zone, threat] of observer.perceivedZoneThreat) {
    const next = threat * (1 - zoneDecayRate);
    if (next < 0.01) {
      observer.perceivedZoneThreat.delete(zone);
    } else {
      observer.perceivedZoneThreat.set(zone, next);
    }
  }
}
