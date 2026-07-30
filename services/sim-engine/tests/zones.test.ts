import { describe, expect, it } from "vitest";
import { buildZoneLayout, getWorldConstants, zoneAt } from "../src/world/index.js";

describe("зоны карты (А.10)", () => {
  it("пять именованных зон, доли из конфига суммируются в 1", () => {
    const zones = buildZoneLayout();
    expect(zones.map((z) => z.name)).toEqual([
      "far_ice",
      "main_ice",
      "north_bay",
      "south_shallows",
      "open_water",
    ]);

    const totalShare = zones.reduce((sum, z) => sum + z.share, 0);
    expect(totalShare).toBeCloseTo(1, 9);
  });

  it("полосы зон покрывают всю ширину карты без разрывов и наложений", () => {
    const zones = buildZoneLayout();
    const { width } = getWorldConstants().world.map;

    expect(zones[0].x0).toBe(0);
    expect(zones[zones.length - 1].x1).toBeCloseTo(width, 6);

    for (let i = 1; i < zones.length; i += 1) {
      expect(zones[i].x0).toBeCloseTo(zones[i - 1].x1, 6);
    }
  });

  it("каждая зона занимает всю высоту карты", () => {
    const zones = buildZoneLayout();
    const { height } = getWorldConstants().world.map;
    for (const zone of zones) {
      expect(zone.y0).toBe(0);
      expect(zone.y1).toBe(height);
    }
  });

  it("zoneAt возвращает верную зону по точке внутри её полосы", () => {
    const zones = buildZoneLayout();
    for (const zone of zones) {
      const midX = (zone.x0 + zone.x1) / 2;
      const midY = zone.y1 / 2;
      expect(zoneAt(midX, midY).name).toBe(zone.name);
    }
  });

  it("zoneAt бросает исключение для точки вне границ карты", () => {
    const { width, height } = getWorldConstants().world.map;
    expect(() => zoneAt(-1, 0)).toThrow();
    expect(() => zoneAt(0, -1)).toThrow();
    expect(() => zoneAt(width + 1, 0)).toThrow();
    expect(() => zoneAt(0, height + 1)).toThrow();
  });

  it("тип зон соответствует конфигу (лёд/вода)", () => {
    const zones = buildZoneLayout();
    const byName = Object.fromEntries(zones.map((z) => [z.name, z]));
    expect(byName.main_ice.type).toBe("ice");
    expect(byName.far_ice.type).toBe("ice");
    expect(byName.north_bay.type).toBe("water");
    expect(byName.south_shallows.type).toBe("water");
    expect(byName.open_water.type).toBe("water");
  });
});
