import { clamp } from "./rng.js";
import { getSimConstants } from "./simConstants.js";
import { distance } from "./huntingAttractiveness.js";
import { aversionKey, bondKey, type AversionRecord, type BondRecord, type Creature } from "./types.js";

/**
 * Шаг 9 тик-пайплайна (А.3): рост силы связи для пар одного вида в радиусе
 * совместного пребывания (А.10). Вызывается один раз за тик на КАЖДУЮ пару
 * (не на каждое существо отдельно) — вызывающая сторона должна гарантировать
 * `creature.id < other.id`, чтобы пара не обрабатывалась дважды.
 */
export function growBondForPair(creature: Creature, other: Creature, bonds: Map<string, BondRecord>): BondRecord | undefined {
  if (creature.species !== other.species) return undefined;
  const constants = getSimConstants().social;
  if (distance(creature.pos, other.pos) > constants.bond_proximity_radius_units) return undefined;

  const key = bondKey(creature.id, other.id);
  let record = bonds.get(key);
  const [a, b] = creature.id < other.id ? [creature.id, other.id] : [other.id, creature.id];
  if (!record) {
    record = { creatureA: a, creatureB: b, kind: "friend", strength: 0 };
    bonds.set(key, record);
  }

  const before = record.strength;
  record.strength = clamp(record.strength + constants.bond_growth_per_tick_within_radius, 0, 1);
  if (before < constants.friendship.threshold && record.strength >= constants.friendship.threshold) {
    record.kind = "friend";
  }
  return record;
}

/**
 * Затухание связей, не подкреплённых в этом тике совместным пребыванием
 * (`touchedKeys` — ключи, обработанные `growBondForPair` в этом тике).
 * Возвращает разорванные связи (strength упала ниже `decay_below` — событие
 * `bond_broken`) для удаления из карты и записи в world_events.
 */
export function decayUntouchedBonds(bonds: Map<string, BondRecord>, touchedKeys: Set<string>): BondRecord[] {
  const constants = getSimConstants().social;
  const broken: BondRecord[] = [];
  for (const [key, record] of bonds) {
    if (touchedKeys.has(key)) continue;
    record.strength = clamp(record.strength - constants.bond_decay_per_tick_apart, 0, 1);
    if (record.strength < constants.friendship.decay_below) {
      broken.push(record);
      bonds.delete(key);
    }
  }
  return broken;
}

/** Создаёт/усиливает избегание (7.2, А.10): стартовая сила = significance травматичного эпизода. */
export function recordAversion(aversions: Map<string, AversionRecord>, subjectId: string, objectId: string, strength: number): void {
  const key = aversionKey(subjectId, objectId);
  const existing = aversions.get(key);
  aversions.set(key, {
    subjectId,
    objectId,
    strength: clamp(Math.max(existing?.strength ?? 0, strength), 0, 1),
  });
}

/** Шаг 9: затухание избегания за реальное время (А.10: −0.01/сутки), удаление ничтожно малых записей. */
export function decayAversions(aversions: Map<string, AversionRecord>, dtRealSeconds: number): void {
  const decayPerDay = getSimConstants().social.aversion_decay_per_day;
  const dtDays = dtRealSeconds / 86400;
  for (const [key, record] of aversions) {
    record.strength = clamp(record.strength - decayPerDay * dtDays, 0, 1);
    if (record.strength < 0.01) aversions.delete(key);
  }
}

export function bondStrengthLookup(bonds: Map<string, BondRecord>, selfId: string) {
  return (otherId: string): number => bonds.get(bondKey(selfId, otherId))?.strength ?? 0;
}

export function aversionStrengthLookup(aversions: Map<string, AversionRecord>, selfId: string) {
  return (otherId: string): number => aversions.get(aversionKey(selfId, otherId))?.strength ?? 0;
}
