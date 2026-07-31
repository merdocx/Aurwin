import { clamp } from "./rng.js";
import { getSimConstants } from "./simConstants.js";
import { ticksToRealSeconds } from "./time.js";
import { TRAIT_KEYS, type Creature, type Intention, type Traits } from "./types.js";

/**
 * Контракт результата рефлексии (А.5), урезанный до того, что реально
 * применяется в фазе 4. Настоящий LLM-вызов — фаза 6 (CLAUDE.md, «Незыблемые
 * правила», п.7). Здесь — заглушка с ФИКСИРОВАННЫМИ намерениями (по прямому
 * указанию промпта фазы 4): дельты черт/весов всегда пустые, но структура
 * (clamp + пожизненный коридор) реализована и протестирована уже сейчас,
 * чтобы фаза 6 подключила настоящие дельты без переделки sim-engine.
 */
export interface ReflectionResult {
  narrative: string;
  narrativeFacts: string[];
  traitDeltas: Partial<Traits>;
  weightDeltas: Record<string, number>;
  intentions: Intention[];
}

/**
 * Заглушка вместо LLM-рефлексии. Намерения фиксированы простым правилом
 * (не LLM): избегать худшей по личному опыту зоны, если такая накопилась.
 * Никаких дельт черт/весов — дрейф остаётся выключенным до фазы 6.
 */
export function generateMockReflection(creature: Creature): ReflectionResult {
  const intentions: Intention[] = [];

  let worstZone: string | undefined;
  let worstScore = 0;
  for (const [zone, score] of Object.entries(creature.habits)) {
    if (score !== undefined && score < worstScore) {
      worstScore = score;
      worstZone = zone;
    }
  }
  if (worstZone) {
    intentions.push({
      text: `держаться подальше от ${worstZone}`,
      effect: { zone_penalty: { [worstZone]: Math.min(0.6, -worstScore) } },
    });
  } else {
    intentions.push({ text: "жить как раньше", effect: {} });
  }

  return {
    narrative: creature.narrativeFacts.length > 0 ? creature.narrativeFacts.join(" ") : "Я продолжаю жить своей жизнью.",
    narrativeFacts: creature.narrativeFacts,
    traitDeltas: {},
    weightDeltas: {},
    intentions,
  };
}

/**
 * Шаг 1 тик-пайплайна (А.3): применение дельт черт с двойным ограничением
 * — clamp за одну рефлексию (reflection.trait_delta_clamp) и пожизненный
 * коридор относительно traits_birth (reflection.trait_lifetime_corridor).
 * С фиксированной заглушкой (пустые дельты) это всегда no-op, но логика
 * реализована и протестирована для фазы 6.
 */
export function applyTraitDeltas(creature: Creature, deltas: Partial<Traits>): void {
  const constants = getSimConstants().reflection;
  for (const key of TRAIT_KEYS) {
    const delta = deltas[key];
    if (delta === undefined) continue;
    const clampedDelta = clamp(delta, -constants.trait_delta_clamp, constants.trait_delta_clamp);
    const birth = creature.traitsBirth[key];
    const proposed = creature.traits[key] + clampedDelta;
    const min = Math.max(-1, birth - constants.trait_lifetime_corridor);
    const max = Math.min(1, birth + constants.trait_lifetime_corridor);
    creature.traits[key] = clamp(proposed, min, max);
  }
}

/** То же для индивидуальных весов U(a) (7.7, механизм 4) — коридор ±0.3 от врождённого. */
export function applyWeightDeltas(creature: Creature, deltas: Record<string, number>): void {
  const constants = getSimConstants().reflection;
  for (const [path, delta] of Object.entries(deltas)) {
    const clampedDelta = clamp(delta, -constants.weight_delta_clamp, constants.weight_delta_clamp);
    applyWeightDeltaAtPath(creature, path, clampedDelta, constants.weight_lifetime_corridor);
  }
}

function applyWeightDeltaAtPath(creature: Creature, path: string, delta: number, corridor: number): void {
  const segments = path.split(".");
  // Поддерживаем только пути глубиной 1-2 (w_trait | w_need.hunger | w_skill | w_habit) —
  // ровно то, что описывает схема weights в А.2.
  if (segments.length === 1 && segments[0] in creature.weights && typeof (creature.weights as any)[segments[0]] === "number") {
    const key = segments[0] as "w_trait" | "w_skill" | "w_habit";
    const birth = (creature.weightsBirth as any)[key] as number;
    const proposed = (creature.weights as any)[key] + delta;
    (creature.weights as any)[key] = clamp(proposed, birth - corridor, birth + corridor);
  } else if (segments.length === 2 && segments[0] === "w_need") {
    const needKey = segments[1] as keyof typeof creature.weights.w_need;
    const birth = creature.weightsBirth.w_need[needKey];
    const proposed = creature.weights.w_need[needKey] + delta;
    creature.weights.w_need[needKey] = clamp(proposed, birth - corridor, birth + corridor);
  }
}

/** Фоновая рефлексия привязана к моменту сна существа (7.10), не к произвольному тику. */
export function shouldTriggerBackgroundReflection(creature: Creature, justFellAsleep: boolean, currentTick: number): boolean {
  if (!justFellAsleep) return false;
  const intervalHours = getSimConstants().reflection.background_interval_hours;
  const elapsedRealSeconds = ticksToRealSeconds(currentTick - creature.lastReflectionAt);
  return elapsedRealSeconds >= intervalHours * 3600;
}
