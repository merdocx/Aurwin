import { describe, expect, it } from "vitest";
import {
  baseSpeed,
  getWorldConstants,
  speedForAgeStage,
  stepAndReflect,
  type Bounds,
} from "../src/world/index.js";

describe("движение и отражение от границ карты (А.10)", () => {
  const bounds: Bounds = { width: 1000, height: 600 };
  const v = 7; // half of former penguin water speed

  it("baseSpeed: скорости на льду/в воде берутся из конфига", () => {
    const constants = getWorldConstants().movement;
    expect(baseSpeed("penguin", "ice")).toBe(constants.ice_speed.penguin);
    expect(baseSpeed("penguin", "water")).toBe(constants.water_speed.penguin);
    expect(baseSpeed("orca", "water")).toBe(constants.water_speed.orca);
  });

  it("baseSpeed: касатка не может передвигаться по льду", () => {
    expect(() => baseSpeed("orca", "ice")).toThrow();
  });

  it("speedForAgeStage: старость снижает скорость множителем из конфига, взрослый/детёныш — нет", () => {
    const multiplier = getWorldConstants().movement.old_age_speed_multiplier;
    const adultSpeed = speedForAgeStage("penguin", "water", "adult");
    const oldSpeed = speedForAgeStage("penguin", "water", "old");

    expect(adultSpeed).toBe(getWorldConstants().movement.water_speed.penguin);
    expect(oldSpeed).toBeCloseTo(adultSpeed * multiplier, 9);
    expect(speedForAgeStage("penguin", "water", "juvenile")).toBe(adultSpeed);
  });

  it("одиночный шаг остаётся внутри границ, если внутри границ и не у края", () => {
    const result = stepAndReflect({ x: 500, y: 300 }, { x: v, y: 0 }, bounds);
    expect(result.position).toEqual({ x: 500 + v, y: 300 });
    expect(result.velocity).toEqual({ x: v, y: 0 });
  });

  it("отражается от правой границы карты и разворачивает скорость по X", () => {
    const result = stepAndReflect({ x: 995, y: 300 }, { x: v, y: 0 }, bounds);
    // 995 + 7 = 1002 -> перелёт на 2 за границу (1000) -> отражённая позиция 998
    expect(result.position.x).toBeCloseTo(998, 9);
    expect(result.position.x).toBeLessThanOrEqual(bounds.width);
    expect(result.velocity.x).toBe(-v);
  });

  it("отражается от левой/верхней/нижней границ аналогично", () => {
    // v=7: 3-7=-4 → reflect1D даёт 4; 597+7=604 → 596 при height=600
    const left = stepAndReflect({ x: 3, y: 300 }, { x: -v, y: 0 }, bounds);
    expect(left.position.x).toBeCloseTo(4, 9);
    expect(left.velocity.x).toBe(v);

    const top = stepAndReflect({ x: 250, y: 3 }, { x: 0, y: -v }, bounds);
    expect(top.position.y).toBeCloseTo(4, 9);
    expect(top.velocity.y).toBe(v);

    const bottom = stepAndReflect({ x: 250, y: 597 }, { x: 0, y: v }, bounds);
    expect(bottom.position.y).toBeCloseTo(596, 9);
    expect(bottom.velocity.y).toBe(-v);
  });

  it("существо не покидает карту при множестве шагов подряд с постоянной скоростью", () => {
    let position = { x: 10, y: 10 };
    let velocity = { x: 11, y: 8 }; // скорость касатки по X (÷2), произвольная по Y

    for (let i = 0; i < 5000; i += 1) {
      const next = stepAndReflect(position, velocity, bounds);
      position = next.position;
      velocity = next.velocity;

      expect(position.x).toBeGreaterThanOrEqual(0);
      expect(position.x).toBeLessThanOrEqual(bounds.width);
      expect(position.y).toBeGreaterThanOrEqual(0);
      expect(position.y).toBeLessThanOrEqual(bounds.height);
    }
  });
});
