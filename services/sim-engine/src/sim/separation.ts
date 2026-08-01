import { getSimConstants } from "./simConstants.js";
import { distance } from "./huntingAttractiveness.js";
import { isAlive, type Creature } from "./types.js";
import { clearFootprintFromLand, ecoZoneAtSim, isLandSim } from "../world/landMask.js";
import type { IndexedPoint, SpatialGrid } from "../world/spatialIndex.js";

/**
 * Мягкое расталкивание живых особей после шага движения.
 * Радиусы = body_radius (визуальный клиренс). Hunt-пары не освобождаются —
 * касание при охоте резолвится смертью отдельно; до контакта пары разводятся
 * как все прочие (плюс pre_contact defense nudge).
 */

export interface SeparationDecision {
  action: string;
  targetId?: string;
}

function capNudge(acc: { x: number; y: number }, dx: number, dy: number, maxNudge: number): { x: number; y: number } {
  let nx = acc.x + dx;
  let ny = acc.y + dy;
  const mag = Math.hypot(nx, ny);
  if (mag > maxNudge) {
    const scale = maxNudge / mag;
    nx *= scale;
    ny *= scale;
  }
  return { x: nx, y: ny };
}

function bodyRadius(c: Creature): number {
  const body = getSimConstants().movement.body_radius_units;
  return c.species === "orca" ? body.orca : body.penguin;
}

export function applySoftSeparation(
  alive: Creature[],
  _decisions: Map<string, SeparationDecision>,
  bounds: { width: number; height: number },
  grid?: SpatialGrid<IndexedPoint>,
): void {
  const {
    iterations,
    max_nudge_units,
    position_nudge_multiplier,
    heading_nudge_weight,
  } = getSimConstants().movement.separation;
  const queryRadius = 2 * getSimConstants().movement.body_radius_units.orca;
  const byId = new Map(alive.map((c) => [c.id, c]));

  function clampCreature(c: Creature): void {
    c.pos.x = Math.min(bounds.width, Math.max(0, c.pos.x));
    c.pos.y = Math.min(bounds.height, Math.max(0, c.pos.y));
    const shore = getSimConstants().movement.shore_clearance_radius_units;
    if (c.species === "orca") {
      c.pos = clearFootprintFromLand(c.pos.x, c.pos.y, shore.orca, bounds);
    } else if (!isLandSim(c.pos.x, c.pos.y)) {
      c.pos = clearFootprintFromLand(c.pos.x, c.pos.y, shore.penguin_water, bounds);
    }
  }

  for (let iter = 0; iter < iterations; iter++) {
    const nudgeAccum = new Map<string, { x: number; y: number }>();

    for (const a of alive) {
      if (!isAlive(a)) continue;

      const neighborPoints = grid
        ? grid.queryRadius(a.pos.x, a.pos.y, queryRadius, a.id)
        : alive.filter((b) => b.id !== a.id).map((b) => ({ id: b.id, x: b.pos.x, y: b.pos.y }));

      for (const point of neighborPoints) {
        const b = byId.get(point.id);
        if (!b || !isAlive(b) || a.id >= b.id) continue;

        const minDist = bodyRadius(a) + bodyRadius(b);
        let d = distance(a.pos, b.pos);
        if (d >= minDist) {
          if (d < 1e-6) {
            const nudgeA = nudgeAccum.get(a.id) ?? { x: 0, y: 0 };
            const nudgeB = nudgeAccum.get(b.id) ?? { x: 0, y: 0 };
            nudgeAccum.set(a.id, capNudge(nudgeA, 0.5, 0, max_nudge_units));
            nudgeAccum.set(b.id, capNudge(nudgeB, -0.5, 0, max_nudge_units));
          }
          continue;
        }

        if (d < 1e-6) d = 1e-6;
        const overlap = (minDist - d) / 2;
        const nx = (b.pos.x - a.pos.x) / d;
        const ny = (b.pos.y - a.pos.y) / d;

        const nudgeA = nudgeAccum.get(a.id) ?? { x: 0, y: 0 };
        const nudgeB = nudgeAccum.get(b.id) ?? { x: 0, y: 0 };
        nudgeAccum.set(a.id, capNudge(nudgeA, -nx * overlap, -ny * overlap, max_nudge_units));
        nudgeAccum.set(b.id, capNudge(nudgeB, nx * overlap, ny * overlap, max_nudge_units));
      }
    }

    for (const c of alive) {
      if (!isAlive(c)) continue;
      const nudge = nudgeAccum.get(c.id);
      if (!nudge) continue;
      if (c.heading !== undefined) {
        const steeringX = Math.cos(c.heading) + nudge.x * heading_nudge_weight;
        const steeringY = Math.sin(c.heading) + nudge.y * heading_nudge_weight;
        if (Math.hypot(steeringX, steeringY) > 0) {
          c.heading = Math.atan2(steeringY, steeringX);
        }
      }
      c.pos.x += nudge.x * position_nudge_multiplier;
      c.pos.y += nudge.y * position_nudge_multiplier;
      clampCreature(c);
      c.zone = ecoZoneAtSim(c.pos.x, c.pos.y);
    }
  }
}

const HUNT_ACTIONS = new Set(["hunt", "stealth_approach", "coordinate_hunt"]);

/**
 * Pre-contact удача: group/guard оттесняют жертву от охотника в полосе
 * перед касанием; coordinate_hunt отменяет срыв (как раньше отменял ×0.6).
 * Возвращает пары, у которых срыв сработал (для эпизодов «промах»).
 */
export function applyPreContactDefense(
  alive: Creature[],
  decisions: Map<string, SeparationDecision>,
  guardedOffspring: Set<string>,
  coordinatedPrey: Map<string, Set<string>>,
  bounds: { width: number; height: number },
  lastBreakTick: Map<string, number>,
  currentTick: number,
): Array<{ orcaId: string; preyId: string }> {
  const h = getSimConstants().hunting;
  const contactR = h.contact_radius_units;
  const band = contactR + h.pre_contact.approach_band_extra_units;
  const nudgeAmt = h.pre_contact.defense_nudge_units;
  const cooldown = h.pre_contact.break_cooldown_ticks;
  const bondR = getSimConstants().social.bond_proximity_radius_units;
  const broken: Array<{ orcaId: string; preyId: string }> = [];
  const byId = new Map(alive.map((c) => [c.id, c]));

  for (const orca of alive) {
    if (!isAlive(orca) || orca.species !== "orca") continue;
    const d = decisions.get(orca.id);
    if (!d || !HUNT_ACTIONS.has(d.action) || !d.targetId) continue;
    const prey = byId.get(d.targetId);
    if (!prey || !isAlive(prey) || prey.species !== "penguin") continue;

    const dist = distance(orca.pos, prey.pos);
    if (dist <= contactR || dist > band) continue;

    const coordinated = (coordinatedPrey.get(prey.id)?.size ?? 0) > 0;
    if (coordinated) continue;

    const nearbySame = alive.filter(
      (c) => c.id !== prey.id && isAlive(c) && c.species === prey.species && distance(prey.pos, c.pos) <= bondR,
    );
    const groupProtected = nearbySame.length + 1 >= 3;
    const guarded = guardedOffspring.has(prey.id);
    if (!groupProtected && !guarded) continue;

    const pairKey = `${orca.id}|${prey.id}`;
    const last = lastBreakTick.get(pairKey);
    if (last !== undefined && currentTick - last < cooldown) continue;

    const mag = dist || 1;
    const nx = (prey.pos.x - orca.pos.x) / mag;
    const ny = (prey.pos.y - orca.pos.y) / mag;
    prey.pos.x += nx * nudgeAmt;
    prey.pos.y += ny * nudgeAmt;
    prey.pos.x = Math.min(bounds.width, Math.max(0, prey.pos.x));
    prey.pos.y = Math.min(bounds.height, Math.max(0, prey.pos.y));
    prey.zone = ecoZoneAtSim(prey.pos.x, prey.pos.y);
    if (prey.heading !== undefined) {
      prey.heading = Math.atan2(ny, nx);
    }

    lastBreakTick.set(pairKey, currentTick);
    broken.push({ orcaId: orca.id, preyId: prey.id });
  }

  return broken;
}
