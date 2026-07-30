import { getWorldConstants } from "./constants.js";
import type { Species } from "./dayNight.js";

export interface Vector2 {
  x: number;
  y: number;
}

export interface Bounds {
  width: number;
  height: number;
}

export type Medium = "ice" | "water";
export type AgeStage = "juvenile" | "adult" | "old";

/** Базовая скорость по виду и среде (А.10: лёд 6 у.е./тик пингвину, вода 14/22). */
export function baseSpeed(species: Species, medium: Medium): number {
  const { movement } = getWorldConstants();
  if (medium === "ice") {
    if (species !== "penguin") {
      throw new Error(`baseSpeed: касатка не передвигается по льду`);
    }
    return movement.ice_speed.penguin;
  }
  return movement.water_speed[species];
}

/** Скорость с учётом возрастной стадии: "старый" ×0.7 (А.10). */
export function speedForAgeStage(species: Species, medium: Medium, ageStage: AgeStage): number {
  const speed = baseSpeed(species, medium);
  if (ageStage !== "old") return speed;
  return speed * getWorldConstants().movement.old_age_speed_multiplier;
}

function reflect1D(pos: number, size: number): { position: number; flipped: boolean } {
  if (size <= 0) return { position: 0, flipped: false };
  const period = 2 * size;
  let folded = pos % period;
  if (folded < 0) folded += period;
  if (folded <= size) return { position: folded, flipped: false };
  return { position: period - folded, flipped: true };
}

/**
 * Один шаг движения: применяет вектор скорости к позиции и отражает
 * результат от границ карты [0,width]x[0,height] (А.10: "без прокрутки за
 * края, существа отражаются от границ"). Компонент скорости, по которому
 * произошло отражение, меняет знак — существо продолжает движение "рикошетом",
 * а не телепортируется и не покидает карту.
 */
export function stepAndReflect(
  position: Vector2,
  velocity: Vector2,
  bounds: Bounds,
): { position: Vector2; velocity: Vector2 } {
  const proposed = { x: position.x + velocity.x, y: position.y + velocity.y };
  const rx = reflect1D(proposed.x, bounds.width);
  const ry = reflect1D(proposed.y, bounds.height);
  return {
    position: { x: rx.position, y: ry.position },
    velocity: {
      x: rx.flipped ? -velocity.x : velocity.x,
      y: ry.flipped ? -velocity.y : velocity.y,
    },
  };
}
