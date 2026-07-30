import { getWorldConstants } from "./constants.js";

/**
 * Порядок полос слева направо (ширина карты, 0..width). Доли берутся из
 * config/constants.yaml (world.zones), но само взаимное расположение зон в
 * ТЗ не задано — раскладка выбрана инженерно и обоснована в
 * ops/DEVIATIONS.md (фаза 3): колония (`main_ice`) граничит с обеими
 * кормовыми зонами, `open_water` (территория касаток) — на
 * противоположном от колонии краю, `far_ice` (убежище, но вдали от еды) —
 * на другом краю, вдали и от колонии, и от воды.
 */
const ZONE_ORDER = ["far_ice", "main_ice", "north_bay", "south_shallows", "open_water"] as const;

export type ZoneName = (typeof ZONE_ORDER)[number];
export type ZoneType = "ice" | "water";

export interface Zone {
  name: ZoneName;
  type: ZoneType;
  share: number;
  /** Границы полосы по X, включительно слева, исключительно справа (кроме последней зоны). */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

let cachedLayout: Zone[] | undefined;

/** Строит раскладку пяти именованных зон на карте (А.10) из констант. */
export function buildZoneLayout(): Zone[] {
  if (cachedLayout) return cachedLayout;

  const constants = getWorldConstants();
  const { width, height } = constants.world.map;
  const zoneConstants = constants.world.zones;

  const totalShare = ZONE_ORDER.reduce((sum, name) => sum + zoneConstants[name].share, 0);
  if (Math.abs(totalShare - 1) > 1e-9) {
    throw new Error(
      `world.zones: доли зон должны суммироваться в 1, получено ${totalShare} (А.10)`,
    );
  }

  let cursor = 0;
  const zones: Zone[] = ZONE_ORDER.map((name) => {
    const { type, share } = zoneConstants[name];
    const x0 = cursor;
    const x1 = cursor + share * width;
    cursor = x1;
    return { name, type, share, x0, x1, y0: 0, y1: height };
  });

  cachedLayout = zones;
  return zones;
}

/** Только для тестов. */
export function resetZoneLayoutCache(): void {
  cachedLayout = undefined;
}

/** Возвращает зону, которой принадлежит точка карты. Бросает исключение вне границ карты. */
export function zoneAt(x: number, y: number): Zone {
  const constants = getWorldConstants();
  const { width, height } = constants.world.map;
  if (x < 0 || x > width || y < 0 || y > height) {
    throw new Error(`zoneAt: точка (${x}, ${y}) вне границ карты ${width}x${height}`);
  }

  const zones = buildZoneLayout();
  const zone = zones.find((z) => x >= z.x0 && (x < z.x1 || z.x1 === width));
  if (!zone) {
    throw new Error(`zoneAt: не найдена зона для x=${x}`);
  }
  return zone;
}

/** Кормовые зоны — единственные, где живёт рыба (А.10). */
export function feedingZoneNames(): ZoneName[] {
  return Object.keys(getWorldConstants().world.fish_respawn_per_tick) as ZoneName[];
}
