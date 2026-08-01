/**
 * Порт геометрии карты Observatory (/tmp/aurwin-ds/ui_kits/observatory/creatures-data.js).
 * Континенты определяются функцией radius(angle) вокруг центра — она же рисует
 * береговую линию (pathD) и позволяет сэмплировать точки гарантированно внутри/снаружи
 * (используется здесь только для расстановки декоративной рыбы).
 */

export interface Bay {
  angle: number;
  width: number;
  depth: number;
}

export interface Continent {
  cx: number;
  cy: number;
  baseR: number;
  radiusAt(angle: number): number;
  pathD(steps?: number): string;
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

export function makeContinent(cx: number, cy: number, baseR: number, bays: Bay[]): Continent {
  function radiusAt(angle: number): number {
    let r = baseR * (1 + 0.14 * Math.sin(3 * angle + 0.6) + 0.09 * Math.sin(5 * angle + 2.1));
    for (const b of bays) r -= baseR * gaussianDip(angle, b.angle, b.width, b.depth);
    return r;
  }
  function pathD(steps = 64): string {
    let d = "";
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const r = radiusAt(a);
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      d += (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1) + " ";
    }
    return d + "Z";
  }
  return { cx, cy, baseR, radiusAt, pathD };
}

/** Основной материк — колония (main_ice); две бухты вырезаны в восточном берегу. */
export const MAIN_LAND: Continent = makeContinent(280, 325, 235, [
  { angle: -0.5, width: 0.55, depth: 0.55 }, // north_bay
  { angle: 0.85, width: 0.5, depth: 0.5 }, // south_shallows
]);
/** Дальняя льдина. */
export const FAR_ICE: Continent = makeContinent(475, 810, 150, [
  { angle: 2.6, width: 0.7, depth: 0.3 },
  { angle: 0.2, width: 0.6, depth: 0.22 },
]);
/** Восточный остров. */
export const THIRD_LAND: Continent = makeContinent(1340, 230, 165, [{ angle: 1.7, width: 0.55, depth: 0.4 }]);

export interface IslandSeed {
  cx: number;
  cy: number;
  r: number;
}

export const MEDIUM_SEEDS: IslandSeed[] = [
  { cx: 825, cy: 150, r: 48 },
  { cx: 925, cy: 260, r: 58 },
  { cx: 860, cy: 380, r: 39 },
  { cx: 1010, cy: 320, r: 50 },
  { cx: 710, cy: 590, r: 42 },
];

export const MAP_W = 1600;
/** Изотропно к симуляции 1000×600 (мир ÷2, 2026-07-31). */
export const MAP_H = 960;

/** Размер симулируемого мира (сервер, config/constants.yaml: world.map). */
export const SIM_W = 1000;
export const SIM_H = 600;

export function toMap(x: number, y: number): { x: number; y: number } {
  return { x: (x / SIM_W) * MAP_W, y: (y / SIM_H) * MAP_H };
}

export function toSim(x: number, y: number): { x: number; y: number } {
  return { x: (x / MAP_W) * SIM_W, y: (y / MAP_H) * SIM_H };
}

function seq<T>(n: number, fn: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => fn(i));
}

export interface SparklePos {
  x: number;
  y: number;
  s: number;
}

export const SPARKLES: SparklePos[] = seq(26, (i) => ({
  x: 625 + ((i * 231) % 950),
  y: 30 + ((i * 337) % 940),
  s: 2 + (i % 3),
}));

export const ICE_SPARKLES: SparklePos[] = seq(14, (i) => ({
  x: 75 + ((i * 173) % 400),
  y: 75 + ((i * 251) % 450),
  s: 2 + (i % 2),
}));

export interface Berg {
  x: number;
  y: number;
  r: number;
}

export const SMALL_BERGS: Berg[] = seq(20, (i) => ({
  x: 350 + ((i * 293) % 1200),
  y: 40 + ((i * 419) % 920),
  r: 5 + (i % 4) * 2,
}));

export const ALL_LANDS: Continent[] = [MAIN_LAND, FAR_ICE, THIRD_LAND];

/** Земля = континенты + средние острова + все микроберги (hit = paint). */
export function isLandMap(p: { x: number; y: number }, margin = 0): boolean {
  for (const land of ALL_LANDS) {
    const a = Math.atan2(p.y - land.cy, p.x - land.cx);
    if (Math.hypot(p.x - land.cx, p.y - land.cy) < land.radiusAt(a) + margin) return true;
  }
  for (const s of MEDIUM_SEEDS) {
    if (Math.hypot(p.x - s.cx, p.y - s.cy) < s.r * 1.15 + margin) return true;
  }
  for (const b of SMALL_BERGS) {
    if (Math.hypot(p.x - b.x, p.y - b.y) < b.r + margin) return true;
  }
  return false;
}

function pointOnAnyLand(p: { x: number; y: number }, margin: number): boolean {
  return isLandMap(p, margin);
}

/** Детерминированный ГПСЧ (как в DS) — декоративная рыба одинакова между перезагрузками. */
function mulberry32(seed: number): () => number {
  let s = seed;
  return function next(): number {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface FishSeed {
  id: string;
  x: number;
  y: number;
  dir: 1 | -1;
  dur: number;
  delay: number;
}

const rand = mulberry32(310772);

function sampleAnyWater(margin: number): { x: number; y: number } {
  for (let tries = 0; tries < 30; tries++) {
    const p = { x: rand() * MAP_W, y: rand() * MAP_H };
    if (!pointOnAnyLand(p, margin)) return p;
  }
  return { x: 800, y: 500 };
}

/** Декоративная рыба открытой воды — не связана с данными сервера. */
export const FISH: FishSeed[] = seq(15, (i) => {
  const pos = sampleAnyWater(20);
  return { id: "fish" + i, x: pos.x, y: pos.y, dir: rand() < 0.5 ? 1 : -1, dur: 2.6 + rand() * 2.4, delay: rand() * 3 };
});

export interface ZoneLabelSeed {
  x: number;
  y: number;
  text: string;
}

const bayN = { a: -0.5, r: MAIN_LAND.baseR * 0.5 };
const bayS = { a: 0.85, r: MAIN_LAND.baseR * 0.5 };

/** Позиции подписей зон — как в WorldScene.jsx, декоративны (не привязаны к серверным zone rects). */
export const ZONE_LABELS: ZoneLabelSeed[] = [
  { x: MAIN_LAND.cx - 130, y: MAIN_LAND.cy - 230, text: "Основной лёд" },
  { x: FAR_ICE.cx - 45, y: FAR_ICE.cy - FAR_ICE.baseR - 20, text: "Дальний лёд" },
  { x: THIRD_LAND.cx - 45, y: THIRD_LAND.cy - THIRD_LAND.baseR - 20, text: "Восточный лёд" },
  { x: MAIN_LAND.cx + Math.cos(bayN.a) * bayN.r - 20, y: MAIN_LAND.cy + Math.sin(bayN.a) * bayN.r - 45, text: "Северная бухта" },
  { x: MAIN_LAND.cx + Math.cos(bayS.a) * bayS.r - 20, y: MAIN_LAND.cy + Math.sin(bayS.a) * bayS.r + 10, text: "Южное мелководье" },
  { x: 1025, y: 50, text: "Открытая вода" },
];
