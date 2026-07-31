import type { RenderCreature } from "../ws/WorldStore";

/** Радиус спрайта существа, у.е. мира (масштабируется вместе с камерой). */
export function radiusFor(c: RenderCreature): number {
  const base = c.species === "orca" ? 22 : 10;
  return c.age_band === "juvenile" ? base * 0.55 : base;
}

export function bodyColorFor(c: RenderCreature): number {
  if (c.species === "orca") return c.is_asleep ? 0x1a2230 : 0x101820;
  return c.is_asleep ? 0x9fb4c7 : 0xf2f6fa;
}

/** Эмоция как абстрактная точка (DS): calm teal / playful amber / afraid coral / grieving violet. */
export function emotionColorFor(c: RenderCreature): number {
  const v = Math.max(-1, Math.min(1, c.emotion.valence));
  const a = Math.max(0, Math.min(1, c.emotion.arousal));
  if (v < -0.35 && a > 0.45) return 0xc1584b; // coral-500 afraid
  if (v < -0.25) return 0x6e6bc4; // aurora-violet-500 grieving
  if (v > 0.2 && a > 0.45) return 0xe0a458; // amber-500 playful
  return 0x1fa9a0; // aurora-teal-500 calm
}

export function emotionRadiusFor(c: RenderCreature): number {
  const arousal = Math.max(0, Math.min(1, c.emotion.arousal));
  return 2 + arousal * 3;
}


export const SIGNAL_COLORS: Record<string, number> = {
  alarm_call: 0xc1584b, // coral
  display_vigor: 0x1fa9a0, // teal
};
