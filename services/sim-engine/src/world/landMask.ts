/**
 * Единая маска земли Design System (континенты + средние острова + микроберги).
 * Координаты заданы в MAP-пространстве 1600×960; запросы из sim — через toMap.
 * Должна совпадать с apps/frontend/src/world/continents.ts (те же числа).
 * 2026-07-31: мир ÷2 (было 3200×1920 / sim 2000×1200).
 */
import type { Medium } from "./movement.js";
import type { ZoneName } from "./zones.js";

export const MAP_W = 1600;
export const MAP_H = 960;
export const SIM_W = 1000;
export const SIM_H = 600;

export interface Bay {
  angle: number;
  width: number;
  depth: number;
}

function wrapAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= 2 * Math.PI;
  while (r < -Math.PI) r += 2 * Math.PI;
  return r;
}

function gaussianDip(angle: number, target: number, width: number, depth: number): number {
  const d = wrapAngle(angle - target);
  return depth * Math.exp(-(d * d) / (width * width));
}

export interface ContinentDef {
  cx: number;
  cy: number;
  baseR: number;
  bays: Bay[];
}

function radiusAt(land: ContinentDef, angle: number): number {
  let r = land.baseR * (1 + 0.14 * Math.sin(3 * angle + 0.6) + 0.09 * Math.sin(5 * angle + 2.1));
  for (const b of land.bays) r -= land.baseR * gaussianDip(angle, b.angle, b.width, b.depth);
  return r;
}

function pointInContinent(land: ContinentDef, x: number, y: number, margin = 0): boolean {
  const a = Math.atan2(y - land.cy, x - land.cx);
  return Math.hypot(x - land.cx, y - land.cy) < radiusAt(land, a) + margin;
}

/** Те же константы, что в frontend continents.ts. */
export const MAIN_LAND: ContinentDef = {
  cx: 280,
  cy: 325,
  baseR: 235,
  bays: [
    { angle: -0.5, width: 0.55, depth: 0.55 },
    { angle: 0.85, width: 0.5, depth: 0.5 },
  ],
};

export const FAR_ICE: ContinentDef = {
  cx: 475,
  cy: 810,
  baseR: 150,
  bays: [
    { angle: 2.6, width: 0.7, depth: 0.3 },
    { angle: 0.2, width: 0.6, depth: 0.22 },
  ],
};

export const THIRD_LAND: ContinentDef = {
  cx: 1340,
  cy: 230,
  baseR: 165,
  bays: [{ angle: 1.7, width: 0.55, depth: 0.4 }],
};

export const MEDIUM_SEEDS = [
  { cx: 825, cy: 150, r: 48 },
  { cx: 925, cy: 260, r: 58 },
  { cx: 860, cy: 380, r: 39 },
  { cx: 1010, cy: 320, r: 50 },
  { cx: 710, cy: 590, r: 42 },
] as const;

function seqBergs(n: number): Array<{ x: number; y: number; r: number }> {
  return Array.from({ length: n }, (_, i) => ({
    x: 350 + ((i * 293) % 1200),
    y: 40 + ((i * 419) % 920),
    r: 5 + (i % 4) * 2,
  }));
}

export const SMALL_BERGS = seqBergs(20);

export function toMap(simX: number, simY: number): { x: number; y: number } {
  return { x: (simX / SIM_W) * MAP_W, y: (simY / SIM_H) * MAP_H };
}

export function toSim(mapX: number, mapY: number): { x: number; y: number } {
  return { x: (mapX / MAP_W) * SIM_W, y: (mapY / MAP_H) * SIM_H };
}

/** Точка на карте — земля (континент / средний остров / микроберг). */
export function isLandMap(mapX: number, mapY: number, margin = 0): boolean {
  if (pointInContinent(MAIN_LAND, mapX, mapY, margin)) return true;
  if (pointInContinent(FAR_ICE, mapX, mapY, margin)) return true;
  if (pointInContinent(THIRD_LAND, mapX, mapY, margin)) return true;
  for (const s of MEDIUM_SEEDS) {
    if (Math.hypot(mapX - s.cx, mapY - s.cy) < s.r * 1.15 + margin) return true;
  }
  for (const b of SMALL_BERGS) {
    if (Math.hypot(mapX - b.x, mapY - b.y) < b.r + margin) return true;
  }
  return false;
}

export function isLandSim(simX: number, simY: number, margin = 0): boolean {
  const m = toMap(simX, simY);
  return isLandMap(m.x, m.y, margin);
}

export function mediumAtSim(simX: number, simY: number): Medium {
  return isLandSim(simX, simY) ? "ice" : "water";
}

/**
 * Мягкие эко-зоны для привычек/рыбы/подписей — НЕ авторитет земля/вода.
 * Земля: по массе льда. Вода у бухт MAIN_LAND → north_bay / south_shallows.
 */
export function ecoZoneAtSim(simX: number, simY: number): ZoneName {
  const { x: mx, y: my } = toMap(simX, simY);

  if (pointInContinent(MAIN_LAND, mx, my)) return "main_ice";
  if (pointInContinent(FAR_ICE, mx, my)) return "far_ice";
  if (pointInContinent(THIRD_LAND, mx, my)) return "far_ice";
  for (const s of MEDIUM_SEEDS) {
    if (Math.hypot(mx - s.cx, my - s.cy) < s.r * 1.15) return "far_ice";
  }
  for (const b of SMALL_BERGS) {
    if (Math.hypot(mx - b.x, my - b.y) < b.r) return "far_ice";
  }

  // Вода в вырезах бухт основного материка.
  const dx = mx - MAIN_LAND.cx;
  const dy = my - MAIN_LAND.cy;
  const dist = Math.hypot(dx, dy);
  if (dist < MAIN_LAND.baseR * 1.15) {
    const a = Math.atan2(dy, dx);
    if (Math.abs(wrapAngle(a - -0.5)) < 0.7) return "north_bay";
    if (Math.abs(wrapAngle(a - 0.85)) < 0.7) return "south_shallows";
  }

  // Кормовые зоны — вода у восточного берега MAIN_LAND (вне контура).
  if (dist < MAIN_LAND.baseR * 1.55 && mx > MAIN_LAND.cx) {
    const a = Math.atan2(dy, dx);
    if (Math.abs(wrapAngle(a - -0.5)) < 0.85) return "north_bay";
    if (Math.abs(wrapAngle(a - 0.85)) < 0.85) return "south_shallows";
  }

  return "open_water";
}

/** Центр мягкой зоны в sim-координатах (для goto_food). */
export function ecoZoneCenterSim(zone: ZoneName): { x: number; y: number } {
  switch (zone) {
    case "main_ice":
      return toSim(MAIN_LAND.cx - 40, MAIN_LAND.cy);
    case "far_ice":
      return toSim(FAR_ICE.cx, FAR_ICE.cy);
    case "north_bay": {
      const r = MAIN_LAND.baseR * 0.55;
      return toSim(MAIN_LAND.cx + Math.cos(-0.5) * r, MAIN_LAND.cy + Math.sin(-0.5) * r);
    }
    case "south_shallows": {
      const r = MAIN_LAND.baseR * 0.55;
      return toSim(MAIN_LAND.cx + Math.cos(0.85) * r, MAIN_LAND.cy + Math.sin(0.85) * r);
    }
    case "open_water":
    default:
      return toSim(1200, 450);
  }
}

/** Сдвиг касатки с земли в ближайшую воду (шаг к open_water). */
export function pushOrcaOffLand(simX: number, simY: number, bounds: { width: number; height: number }): { x: number; y: number } {
  if (!isLandSim(simX, simY)) return { x: simX, y: simY };
  const target = ecoZoneCenterSim("open_water");
  let x = simX;
  let y = simY;
  for (let i = 0; i < 40; i++) {
    const dx = target.x - x;
    const dy = target.y - y;
    const mag = Math.hypot(dx, dy) || 1;
    x += (dx / mag) * 4;
    y += (dy / mag) * 4;
    x = Math.min(bounds.width, Math.max(0, x));
    y = Math.min(bounds.height, Math.max(0, y));
    if (!isLandSim(x, y)) return { x, y };
  }
  // Fallback: правый край карты (обычно open water).
  return { x: bounds.width * 0.92, y: Math.min(bounds.height, Math.max(0, simY)) };
}

function footprintTouchesLand(x: number, y: number, radius: number): boolean {
  if (isLandSim(x, y, 0)) return true;
  const samples = 16;
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * Math.PI * 2;
    if (isLandSim(x + Math.cos(a) * radius, y + Math.sin(a) * radius, 0)) return true;
  }
  return false;
}

/**
 * Центр + shore radius целиком в воде («стена» берега).
 * Радиус = halfLength спрайта; вызывать во сне и после separation.
 */
export function clearFootprintFromLand(
  simX: number,
  simY: number,
  radius: number,
  bounds: { width: number; height: number },
): { x: number; y: number } {
  if (radius <= 0) return { x: simX, y: simY };

  let x = simX;
  let y = simY;
  if (isLandSim(x, y)) {
    const pushed = pushOrcaOffLand(x, y, bounds);
    x = pushed.x;
    y = pushed.y;
  }
  if (!footprintTouchesLand(x, y, radius)) return { x, y };

  const target = ecoZoneCenterSim("open_water");
  for (let step = 0; step < 64; step++) {
    const dx = target.x - x;
    const dy = target.y - y;
    const mag = Math.hypot(dx, dy) || 1;
    x += (dx / mag) * Math.max(2, radius * 0.15);
    y += (dy / mag) * Math.max(2, radius * 0.15);
    x = Math.min(bounds.width, Math.max(0, x));
    y = Math.min(bounds.height, Math.max(0, y));
    if (!footprintTouchesLand(x, y, radius)) return { x, y };
  }
  return pushOrcaOffLand(x, y, bounds);
}

/** @deprecated alias — use clearFootprintFromLand */
export const clearOrcaFootprintFromLand = clearFootprintFromLand;

/** Сэмпл точки на земле / в воде для genesis. */
export function sampleLandSim(rng: () => number, tries = 80): { x: number; y: number } {
  for (let i = 0; i < tries; i++) {
    const mx = rng() * MAP_W;
    const my = rng() * MAP_H;
    if (pointInContinent(MAIN_LAND, mx, my, -4)) return toSim(mx, my);
  }
  return toSim(MAIN_LAND.cx - 20, MAIN_LAND.cy);
}

export function sampleWaterSim(rng: () => number, tries = 80): { x: number; y: number } {
  for (let i = 0; i < tries; i++) {
    const mx = 900 + rng() * 600;
    const my = rng() * MAP_H;
    if (!isLandMap(mx, my, 10)) return toSim(mx, my);
  }
  return toSim(1200, 300);
}
