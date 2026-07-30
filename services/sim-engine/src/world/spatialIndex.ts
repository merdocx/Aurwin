export interface IndexedPoint {
  id: string;
  x: number;
  y: number;
}

/**
 * Равномерная сетка для поиска соседей в радиусе восприятия — понадобится
 * фазе 4 для sense() (7.8.1) и определяет производительность (цель 5:
 * тик < 500 мс при целевой популяции). Перестраивается заново каждый тик
 * из текущих позиций существ (дешевле, чем инкрементальные обновления, и
 * проще при постоянно меняющихся позициях).
 */
export class SpatialGrid<T extends IndexedPoint> {
  private readonly cellSize: number;
  private cells = new Map<string, T[]>();

  constructor(cellSize: number) {
    if (!(cellSize > 0)) {
      throw new Error(`SpatialGrid: cellSize должен быть > 0, получено ${cellSize}`);
    }
    this.cellSize = cellSize;
  }

  private key(cx: number, cy: number): string {
    return `${cx}:${cy}`;
  }

  private cellCoords(x: number, y: number): [number, number] {
    return [Math.floor(x / this.cellSize), Math.floor(y / this.cellSize)];
  }

  clear(): void {
    this.cells.clear();
  }

  insert(point: T): void {
    const [cx, cy] = this.cellCoords(point.x, point.y);
    const k = this.key(cx, cy);
    const bucket = this.cells.get(k);
    if (bucket) {
      bucket.push(point);
    } else {
      this.cells.set(k, [point]);
    }
  }

  /** Полная перестройка индекса из текущего набора точек (вызывается раз за тик). */
  rebuild(points: Iterable<T>): void {
    this.clear();
    for (const point of points) this.insert(point);
  }

  /** Все точки в радиусе `radius` от (x, y), включая границу. */
  queryRadius(x: number, y: number, radius: number, excludeId?: string): T[] {
    const [centerCx, centerCy] = this.cellCoords(x, y);
    const span = Math.ceil(radius / this.cellSize);
    const radiusSq = radius * radius;
    const result: T[] = [];

    for (let cx = centerCx - span; cx <= centerCx + span; cx++) {
      for (let cy = centerCy - span; cy <= centerCy + span; cy++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (!bucket) continue;
        for (const point of bucket) {
          if (excludeId !== undefined && point.id === excludeId) continue;
          const dx = point.x - x;
          const dy = point.y - y;
          if (dx * dx + dy * dy <= radiusSq) result.push(point);
        }
      }
    }
    return result;
  }
}
