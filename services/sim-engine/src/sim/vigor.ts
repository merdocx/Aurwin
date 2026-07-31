import { clamp } from "./rng.js";
import type { AgeStage, Creature } from "./types.js";

/**
 * Истинная бодрость/сила (7.8.1): "производная от энергии, возраста, навыка
 * evasion". Формула — инженерная (ТЗ не даёт весов), но использует ровно
 * перечисленные три входа. Старость снижает бодрость (возрастной множитель).
 */
export function trueVigor(creature: Creature, ageStage: AgeStage): number {
  const ageFactor = ageStage === "old" ? 0.5 : 1;
  return clamp(0.5 * creature.needs.energy + 0.3 * creature.skills.evasion + 0.2 * ageFactor, 0, 1);
}
