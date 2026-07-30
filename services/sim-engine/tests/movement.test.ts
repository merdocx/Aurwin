import { describe, expect, it } from "vitest";
import {
  baseSpeed,
  getWorldConstants,
  speedForAgeStage,
  stepAndReflect,
  type Bounds,
} from "../src/world/index.js";

describe("движение и отражение от границ карты (А.10)", () => {
  const bounds: Bounds = { width: 2000, height: 1200 };

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
    const result = stepAndReflect({ x: 1000, y: 600 }, { x: 14, y: 0 }, bounds);
    expect(result.position).toEqual({ x: 1014, y: 600 });
    expect(result.velocity).toEqual({ x: 14, y: 0 });
  });

  it("отражается от правой границы карты и разворачивает скорость по X", () => {
    const result = stepAndReflect({ x: 1995, y: 600 }, { x: 14, y: 0 }, bounds);
    // 1995 + 14 = 2009 -> перелёт на 9 за границу (2000) -> отражённая позиция 1991
    expect(result.position.x).toBeCloseTo(1991, 9);
    expect(result.position.x).toBeLessThanOrEqual(bounds.width);
    expect(result.velocity.x).toBe(-14);
  });

  it("отражается от левой/верхней/нижней границ аналогично", () => {
    const left = stepAndReflect({ x: 3, y: 600 }, { x: -14, y: 0 }, bounds);
    expect(left.position.x).toBeCloseTo(11, 9);
    expect(left.velocity.x).toBe(14);

    const top = stepAndReflect({ x: 500, y: 3 }, { x: 0, y: -14 }, bounds);
    expect(top.position.y).toBeCloseTo(11, 9);
    expect(top.velocity.y).toBe(14);

    const bottom = stepAndReflect({ x: 500, y: 1197 }, { x: 0, y: 14 }, bounds);
    expect(bottom.position.y).toBeCloseTo(1189, 9);
    expect(bottom.velocity.y).toBe(-14);
  });

  it("существо не покидает карту при множестве шагов подряд с постоянной скоростью", () => {
    let position = { x: 10, y: 10 };
    let velocity = { x: 22, y: 17 }; // скорость касатки по X, произвольная по Y

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

  it("существо не покидает карту даже при аномально большой скорости за один тик", () => {
    let position = { x: 500, y: 500 };
    let velocity = { x: 5000, y: -3500 };

    for (let i = 0; i < 50; i += 1) {
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
