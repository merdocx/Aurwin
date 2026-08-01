import { clamp } from "./rng.js";
import type { Creature } from "./types.js";

/**
 * Эвристические сдвиги valence/arousal на ключевых событиях (P1 personality).
 * Не в constants.yaml — см. ops/DEVIATIONS.md.
 */
export const EMOTION_DELTAS = {
  hunt_success_orca: { valence: 0.25, arousal: 0.2 },
  hunt_fail_orca: { valence: -0.12, arousal: 0.1 },
  /** Страх после почти-смерти — отрицательный valence для fearTerm(flee). */
  hunt_survived_prey: { valence: -0.28, arousal: 0.45 },
  /** Первый взгляд на касатку в радиусе. */
  see_orca: { valence: -0.18, arousal: 0.35 },
  friend_died: { valence: -0.35, arousal: 0.25 },
  birth_parent: { valence: 0.2, arousal: 0.15 },
  woken_by_alarm: { valence: -0.1, arousal: 0.4 },
} as const;

export function clampEmotion(creature: Creature): void {
  creature.emotion.valence = clamp(creature.emotion.valence, -1, 1);
  creature.emotion.arousal = clamp(creature.emotion.arousal, 0, 1);
}

export function applyEmotionDelta(creature: Creature, delta: { valence?: number; arousal?: number }): void {
  if (delta.valence !== undefined) creature.emotion.valence += delta.valence;
  if (delta.arousal !== undefined) creature.emotion.arousal += delta.arousal;
  clampEmotion(creature);
}
