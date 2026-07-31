import { getConstants } from "./config.js";

/**
 * Статическая раскладка зон для payload snapshot (А.6: `{tick, creatures, zones}`).
 * Дублирует геометрию services/sim-engine/src/world/zones.ts (та же
 * раскладка полос слева направо, см. ops/DEVIATIONS.md фаза 3) — api-gateway
 * не зависит от sim-engine (только от общего config/constants.yaml).
 */
const ZONE_ORDER = ["far_ice", "main_ice", "north_bay", "south_shallows", "open_water"] as const;

export interface ZoneDto {
  name: string;
  type: "ice" | "water";
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

let cached: ZoneDto[] | undefined;

export function zoneLayout(): ZoneDto[] {
  if (cached) return cached;
  const { world } = getConstants();
  const { width, height } = world.map;
  let cursor = 0;
  cached = ZONE_ORDER.map((name) => {
    const { type, share } = world.zones[name];
    const x0 = cursor;
    const x1 = cursor + share * width;
    cursor = x1;
    return { name, type, x0, x1, y0: 0, y1: height };
  });
  return cached;
}
