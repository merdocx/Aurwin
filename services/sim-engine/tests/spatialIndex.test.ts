import { describe, expect, it } from "vitest";
import { SpatialGrid, type IndexedPoint } from "../src/world/index.js";

function bruteForceRadius(points: IndexedPoint[], x: number, y: number, radius: number): string[] {
  const radiusSq = radius * radius;
  return points
    .filter((p) => (p.x - x) ** 2 + (p.y - y) ** 2 <= radiusSq)
    .map((p) => p.id)
    .sort();
}

describe("пространственный индекс соседей (нужен фазе 4 для sense(), цель 5)", () => {
  it("пустой индекс не находит соседей", () => {
    const grid = new SpatialGrid<IndexedPoint>(50);
    expect(grid.queryRadius(0, 0, 100)).toEqual([]);
  });

  it("находит точку внутри радиуса и не находит точку вне радиуса", () => {
    const grid = new SpatialGrid<IndexedPoint>(50);
    grid.insert({ id: "near", x: 10, y: 0 });
    grid.insert({ id: "far", x: 500, y: 0 });

    const found = grid.queryRadius(0, 0, 120).map((p) => p.id);
    expect(found).toEqual(["near"]);
  });

  it("excludeId исключает саму точку из результата (например, себя при поиске соседей)", () => {
    const grid = new SpatialGrid<IndexedPoint>(50);
    grid.insert({ id: "self", x: 0, y: 0 });
    grid.insert({ id: "other", x: 5, y: 0 });

    const withSelf = grid.queryRadius(0, 0, 10).map((p) => p.id).sort();
    expect(withSelf).toEqual(["other", "self"]);

    const withoutSelf = grid.queryRadius(0, 0, 10, "self").map((p) => p.id);
    expect(withoutSelf).toEqual(["other"]);
  });

  it("совпадает с полным перебором на случайном наборе точек, разных радиусах и размерах ячейки", () => {
    const points: IndexedPoint[] = Array.from({ length: 300 }, (_, i) => ({
      id: `p${i}`,
      x: Math.random() * 2000,
      y: Math.random() * 1200,
    }));

    for (const cellSize of [25, 60, 150, 400]) {
      const grid = new SpatialGrid<IndexedPoint>(cellSize);
      grid.rebuild(points);

      for (const radius of [40, 120, 200]) {
        const queryPoint = points[Math.floor(Math.random() * points.length)];
        const viaGrid = grid
          .queryRadius(queryPoint.x, queryPoint.y, radius)
          .map((p) => p.id)
          .sort();
        const viaBrute = bruteForceRadius(points, queryPoint.x, queryPoint.y, radius);
        expect(viaGrid).toEqual(viaBrute);
      }
    }
  });

  it("rebuild заменяет предыдущее содержимое индекса целиком", () => {
    const grid = new SpatialGrid<IndexedPoint>(50);
    grid.insert({ id: "stale", x: 0, y: 0 });
    grid.rebuild([{ id: "fresh", x: 0, y: 0 }]);

    const found = grid.queryRadius(0, 0, 10).map((p) => p.id);
    expect(found).toEqual(["fresh"]);
  });
});
