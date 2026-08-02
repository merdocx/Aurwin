import type { CreatureActivity } from "../ws/types";

export const ACTION_BUBBLE_MS = 3000;
export const THOUGHT_BUBBLE_MS = 5500;
export const MAX_THOUGHT_BUBBLES = 4;

const ACTION_LABELS: Partial<Record<CreatureActivity, string>> = {
  flee: "бегство",
  hunt: "охота",
  forage: "ловит рыбу",
  sleep: "спит",
};

export type BubbleKind = "action" | "thought";

export interface CreatureBubble {
  creatureId: string;
  kind: BubbleKind;
  text: string;
  expiresAt: number;
  /** Для мысли: время появления (приоритет свежести). */
  startedAt: number;
}

export function actionLabelFor(activity: CreatureActivity | undefined): string | null {
  if (!activity) return null;
  return ACTION_LABELS[activity] ?? null;
}

/**
 * Обновляет облачка по смене activity / thought.
 * Первый раз увидеть существо — только запомнить состояние (без облачка).
 * Мысли: лимит MAX_THOUGHT_BUBBLES; выбранный в приоритете.
 */
export function syncCreatureBubbles(opts: {
  now: number;
  bubbles: Map<string, CreatureBubble>;
  activities: Map<string, CreatureActivity | undefined>;
  thoughts: Map<string, string | undefined>;
  prevActivity: Map<string, CreatureActivity | undefined>;
  prevThought: Map<string, string | undefined>;
  focusCreatureId?: string | null;
}): CreatureBubble[] {
  const { now, bubbles, activities, thoughts, prevActivity, prevThought, focusCreatureId } = opts;

  for (const [id, activity] of activities) {
    if (!prevActivity.has(id)) {
      prevActivity.set(id, activity);
      continue;
    }
    if (activity !== prevActivity.get(id)) {
      prevActivity.set(id, activity);
      const label = actionLabelFor(activity);
      if (label) {
        bubbles.set(`action:${id}`, {
          creatureId: id,
          kind: "action",
          text: label,
          expiresAt: now + ACTION_BUBBLE_MS,
          startedAt: now,
        });
      } else {
        bubbles.delete(`action:${id}`);
      }
    }
  }

  for (const [id, thought] of thoughts) {
    const trimmed = thought?.trim() || undefined;
    if (!prevThought.has(id)) {
      prevThought.set(id, trimmed);
      continue;
    }
    if (trimmed && trimmed !== prevThought.get(id)) {
      prevThought.set(id, trimmed);
      bubbles.set(`thought:${id}`, {
        creatureId: id,
        kind: "thought",
        text: trimmed,
        expiresAt: now + THOUGHT_BUBBLE_MS,
        startedAt: now,
      });
    } else if (!trimmed && prevThought.get(id)) {
      prevThought.set(id, undefined);
    }
  }

  for (const [key, b] of bubbles) {
    if (b.expiresAt <= now) bubbles.delete(key);
  }

  const thoughtsActive = [...bubbles.values()].filter((b) => b.kind === "thought");
  if (thoughtsActive.length > MAX_THOUGHT_BUBBLES) {
    thoughtsActive.sort((a, b) => {
      const aFocus = a.creatureId === focusCreatureId ? 1 : 0;
      const bFocus = b.creatureId === focusCreatureId ? 1 : 0;
      if (aFocus !== bFocus) return bFocus - aFocus;
      return b.startedAt - a.startedAt;
    });
    const keep = new Set(thoughtsActive.slice(0, MAX_THOUGHT_BUBBLES).map((b) => b.creatureId));
    for (const [key, b] of bubbles) {
      if (b.kind === "thought" && !keep.has(b.creatureId)) bubbles.delete(key);
    }
  }

  const byCreature = new Map<string, CreatureBubble>();
  for (const b of bubbles.values()) {
    const existing = byCreature.get(b.creatureId);
    if (!existing) {
      byCreature.set(b.creatureId, b);
      continue;
    }
    if (b.kind === "thought" && existing.kind === "action") {
      byCreature.set(b.creatureId, b);
    } else if (b.kind === existing.kind && b.startedAt >= existing.startedAt) {
      byCreature.set(b.creatureId, b);
    }
  }
  return [...byCreature.values()];
}
