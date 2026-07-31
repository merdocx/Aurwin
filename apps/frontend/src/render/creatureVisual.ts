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

/** Валентность -1..1 -> оттенок от красного (плохо) через жёлтый к зелёному (хорошо). */
export function emotionColorFor(c: RenderCreature): number {
  const v = Math.max(-1, Math.min(1, c.emotion.valence));
  const hue = ((v + 1) / 2) * 120; // 0 = красный, 120 = зелёный
  return hslToHex(hue, 0.75, 0.5);
}

export function emotionRadiusFor(c: RenderCreature): number {
  const arousal = Math.max(0, Math.min(1, c.emotion.arousal));
  return 2 + arousal * 3;
}

function hslToHex(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toByte = (v: number) => Math.round((v + m) * 255);
  return (toByte(r) << 16) | (toByte(g) << 8) | toByte(b);
}

export const SIGNAL_COLORS: Record<string, number> = {
  alarm_call: 0xff4d4d,
  display_vigor: 0x4da6ff,
};
