import { clamp } from "./rng.js";
import { getSimConstants } from "./simConstants.js";
import type { Creature, Vector2 } from "./types.js";

export function distance(a: Vector2, b: Vector2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function normalizedDistance(orca: Creature, prey: Creature, maxRadius: number): number {
  if (maxRadius <= 0) return 0;
  return clamp(distance(orca.pos, prey.pos) / maxRadius, 0, 1);
}

export interface AttractivenessInputs {
  perceivedVigor: number; // 0..1 — воспринимаемая КАСАТКОЙ бодрость жертвы (7.8.3)
  normalizedDist: number; // 0..1
  groupProtected: boolean; // жертва в группе >=3 сородичей (А.10)
  isJuvenile: boolean;
}

/**
 * attractiveness() касатки по А.4/7.8.3: ранжирует жертв по ВОСПРИНИМАЕМОЙ
 * бодрости, не истинной — ключевое условие цели 8 из раздела 2. `w_vigor` и
 * прочие веса берутся из индивидуальной, потенциально дрейфующей копии
 * касатки (7.8.4) — при её отсутствии (не должно случаться у касатки, но
 * защитно) используются genesis-дефолты.
 */
export function attractiveness(orca: Creature, inputs: AttractivenessInputs): number {
  const w = orca.weights.hunt_attractiveness ?? getSimConstants().hunting.attractiveness_weight_defaults;
  const { juvenile_stage_bonus, adult_stage_bonus } = getSimConstants().hunting;
  const stageBonus = inputs.isJuvenile ? juvenile_stage_bonus : adult_stage_bonus;
  const groupProtectionValue = inputs.groupProtected ? 1 : 0;
  return (
    w.w_vigor * (1 - inputs.perceivedVigor) +
    w.w_dist * (1 - inputs.normalizedDist) +
    w.w_group * (1 - groupProtectionValue) +
    w.w_stage * stageBonus
  );
}
