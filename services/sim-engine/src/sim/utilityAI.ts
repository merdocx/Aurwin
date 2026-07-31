import { clamp, type Rng } from "./rng.js";
import { getSimConstants } from "./simConstants.js";
import { ageStageFor, ageWeeksAt } from "./lifecycle.js";
import { isForbiddenPair } from "./reproduction.js";
import { sleepUtilityBias } from "./needs.js";
import { attractiveness, distance, normalizedDistance } from "./huntingAttractiveness.js";
import { perceptionRadiusFor } from "./perception.js";
import type { Phase } from "../world/dayNight.js";
import { buildZoneLayout, type ZoneName } from "../world/zones.js";
import type { AgeStage, Creature, DecisionFactor, Traits } from "./types.js";

/**
 * "Опасность"/благоприятность зон — качественная характеристика из текста
 * А.10 ("north_bay — рискованное изобилие", "south_shallows — безопасная
 * бедность", "open_water — для пингвинов опасна"), не выписанная числом
 * нигде в ТЗ. Кодируется здесь как эвристика поведения (не как "константа
 * симуляции" А.9 — влияет только на то, КАК caution/courage модулируют
 * выбор зоны, а не на баланс экосистемы), симметрично для обоих видов:
 * для касатки риск зон почти не имеет смысла (у неё нет естественных
 * хищников), поэтому термин используется только в решениях пингвина.
 */
const ZONE_RISK: Partial<Record<ZoneName, number>> = {
  north_bay: 0.6,
  south_shallows: 0.2,
  main_ice: 0.1,
  far_ice: 0.05,
  open_water: 0.85,
};

function zoneRisk(zone: ZoneName): number {
  return ZONE_RISK[zone] ?? 0.3;
}

/**
 * Касатка физически не может преследовать пингвина на льду (нет среды
 * передвижения — `world/movement.ts` бросает исключение для касатки на
 * льду). Пингвин на льду в принципе вне досягаемости хищника, поэтому цели
 * для hunt/stealth_approach/coordinate_hunt ограничены водными зонами.
 */
function isWaterZone(zone: ZoneName): boolean {
  return buildZoneLayout().find((z) => z.name === zone)?.type === "water";
}

export interface DecideContext {
  creature: Creature;
  currentTick: number;
  phase: Phase;
  visible: Creature[];
  fishAvailability: (zone: ZoneName) => number;
  bondStrength: (otherId: string) => number;
  aversionStrength: (otherId: string) => number;
  rng: Rng;
  /** Только для тестов/детерминированных прогонов: перекрывает utility_ai.noise_epsilon_max. */
  noiseMaxOverride?: number;
  /**
   * Множитель заметности потенциальной жертвы (7.9: `guard_offspring`
   * повышает заметность родителя; 7.10: `alarm_call` — заметность
   * кричавшего) — применяется поверх attractiveness() при выборе цели
   * касаткой. 1 по умолчанию (нет бонуса).
   */
  visibilityMultiplier?: (creatureId: string) => number;
}

export interface Decision {
  action: string;
  targetId?: string;
  zone?: ZoneName;
  factors: DecisionFactor[];
}

function needTerm(creature: Creature, contributions: Partial<Record<"hunger" | "energy" | "social" | "sleep", number>>): number {
  let total = 0;
  const w = creature.weights.w_need;
  if (contributions.hunger) total += w.hunger * contributions.hunger;
  if (contributions.energy) total += w.energy * contributions.energy;
  if (contributions.social) total += w.social * contributions.social;
  if (contributions.sleep) total += w.sleep * contributions.sleep;
  return total;
}

function traitTerm(creature: Creature, score: (traits: Traits) => number): number {
  return creature.weights.w_trait * score(creature.traits);
}

function skillTerm(creature: Creature, value: number): number {
  return creature.weights.w_skill * value;
}

function habitTerm(creature: Creature, zone: ZoneName | undefined): number {
  if (!zone) return 0;
  return creature.weights.w_habit * (creature.habits[zone] ?? 0);
}

function fearTerm(creature: Creature): number {
  return Math.max(0, -creature.emotion.valence) * creature.emotion.arousal;
}

function playfulTerm(creature: Creature): number {
  return Math.max(0, creature.emotion.valence) * (1 - creature.emotion.arousal * 0.5);
}

function intentionTerm(creature: Creature, zone: ZoneName | undefined, targetId: string | undefined, isCourt: boolean): number {
  let total = 0;
  for (const intention of creature.intentions) {
    const eff = intention.effect;
    if (zone && eff.zone_penalty?.[zone] !== undefined) total -= eff.zone_penalty[zone]!;
    if (zone && eff.zone_bonus?.[zone] !== undefined) total += eff.zone_bonus[zone]!;
    if (targetId && eff.approach_bonus?.creature === targetId) total += eff.approach_bonus.value;
    if (targetId && eff.avoid_creature?.creature === targetId) total -= eff.avoid_creature.value;
    if (isCourt && eff.seek_mate) total += 0.3;
  }
  return total;
}

interface Candidate {
  name: string;
  targetId?: string;
  zone?: ZoneName;
  utility: number;
  breakdown: Record<string, number>;
}

function finalize(name: string, zone: ZoneName | undefined, targetId: string | undefined, breakdown: Record<string, number>, rng: Rng, noiseMax: number): Candidate {
  const noise = rng.noise(noiseMax);
  breakdown.noise = noise;
  const utility = Object.values(breakdown).reduce((s, v) => s + v, 0);
  return { name, zone, targetId, utility, breakdown };
}

/** Ближайший сосед данного вида среди видимых (кроме себя). */
function nearestOfSpecies(creature: Creature, visible: Creature[], species: Creature["species"]): Creature | undefined {
  let best: Creature | undefined;
  let bestDist = Infinity;
  for (const other of visible) {
    if (other.species !== species) continue;
    const d = distance(creature.pos, other.pos);
    if (d < bestDist) {
      bestDist = d;
      best = other;
    }
  }
  return best;
}

/**
 * Utility AI уровня 1 (А.4): для каждого доступного действия считает
 * U(a) = Σ w_need·f + Σ w_trait·g + w_skill·skill(a) + w_habit·habit(zone) +
 * emotion_mod(a) + intention_bonus(a) + ε, выбирает argmax. Шум ε строго
 * меньше типичного вклада черт (проверяется тестом utilityAI.test.ts) —
 * иначе решения перестанут быть атрибутируемы чертам/памяти (цель 2).
 */
export function decide(ctx: DecideContext): Decision {
  const { creature, currentTick, phase, visible, fishAvailability, bondStrength, aversionStrength, rng } = ctx;
  const constants = getSimConstants();
  const noiseMax = ctx.noiseMaxOverride ?? constants.utility_ai.noise_epsilon_max;
  const ageWeeks = ageWeeksAt(creature.bornAtTick, currentTick);
  const ageStage = ageStageFor(creature.species, ageWeeks);
  const isNight = phase === "night";

  const candidates: Candidate[] = [];

  // idle — гарантированный минимальный вариант (всегда доступен).
  candidates.push(
    finalize(
      "idle",
      creature.zone,
      undefined,
      { baseline: 0.05, habit: habitTerm(creature, creature.zone) * 0.3 },
      rng,
      noiseMax,
    ),
  );

  // wander — движимо любопытством.
  candidates.push(
    finalize(
      "wander",
      creature.zone,
      undefined,
      {
        baseline: 0.08,
        trait: traitTerm(creature, (t) => t.curiosity * 0.3),
        habit: habitTerm(creature, creature.zone),
        emotion: playfulTerm(creature) * 0.1,
      },
      rng,
      noiseMax,
    ),
  );

  // sleep — давление сна + хронотип/сутки (7.10).
  candidates.push(
    finalize(
      "sleep",
      creature.zone,
      undefined,
      {
        need: needTerm(creature, { sleep: creature.needs.sleep_pressure, energy: 1 - creature.needs.energy }),
        chronotype: sleepUtilityBias(creature, isNight),
        habit: habitTerm(creature, creature.zone) * 0.5,
      },
      rng,
      noiseMax,
    ),
  );

  if (creature.species === "penguin") {
    decidePenguinActions(candidates, ctx, ageStage, ageWeeks, isNight, noiseMax);
  } else {
    decideOrcaActions(candidates, ctx, ageStage, ageWeeks, isNight, noiseMax);
  }

  candidates.sort((a, b) => b.utility - a.utility);
  const best = candidates[0];

  const factors: DecisionFactor[] = candidates.map((c) => ({
    action: c.targetId ? `${c.name}(${c.targetId})` : c.name,
    utility: c.utility,
    breakdown: c.breakdown,
  }));

  return { action: best.name, targetId: best.targetId, zone: best.zone, factors };
}

function decidePenguinActions(
  candidates: Candidate[],
  ctx: DecideContext,
  ageStage: AgeStage,
  ageWeeks: number,
  isNight: boolean,
  noiseMax: number,
): void {
  const { creature, visible, fishAvailability, bondStrength, aversionStrength, rng, currentTick } = ctx;
  const constants = getSimConstants();
  const feedingZones = Object.keys(constants.world.fish_respawn_per_tick) as ZoneName[];

  // goto_food: лучшая по (доступность рыбы + личная привычка - осторожность*риск) кормовая зона.
  let bestFeedingZone: ZoneName = feedingZones[0];
  let bestFeedingScore = -Infinity;
  for (const zone of feedingZones) {
    const score =
      fishAvailability(zone) * 0.6 + (creature.habits[zone] ?? 0) * 0.3 - creature.traits.caution * zoneRisk(zone) * 0.4;
    if (score > bestFeedingScore) {
      bestFeedingScore = score;
      bestFeedingZone = zone;
    }
  }
  if (creature.zone !== bestFeedingZone) {
    candidates.push(
      finalize(
        "goto_food",
        bestFeedingZone,
        undefined,
        {
          need: needTerm(creature, { hunger: creature.needs.hunger }),
          skill: skillTerm(creature, creature.skills.foraging),
          habit: habitTerm(creature, bestFeedingZone),
          trait: traitTerm(creature, (t) => t.courage * zoneRisk(bestFeedingZone) * 0.3 - t.caution * zoneRisk(bestFeedingZone) * 0.3),
          intention: intentionTerm(creature, bestFeedingZone, undefined, false),
        },
        rng,
        noiseMax,
      ),
    );
  }

  // eat: доступно только если сейчас в кормовой зоне с рыбой.
  if ((feedingZones as string[]).includes(creature.zone) && fishAvailability(creature.zone as ZoneName) > 0) {
    candidates.push(
      finalize(
        "eat",
        creature.zone,
        undefined,
        {
          need: needTerm(creature, { hunger: creature.needs.hunger * 1.5 }),
          skill: skillTerm(creature, creature.skills.foraging),
          habit: habitTerm(creature, creature.zone),
        },
        rng,
        noiseMax,
      ),
    );
  }

  // Видимые касатки -> flee / display_vigor / alarm_call.
  const orcasVisible = visible.filter((v) => v.species === "orca");
  if (orcasVisible.length > 0) {
    let nearestOrca = orcasVisible[0];
    let nearestDist = distance(creature.pos, nearestOrca.pos);
    for (const orca of orcasVisible) {
      const d = distance(creature.pos, orca.pos);
      if (d < nearestDist) {
        nearestDist = d;
        nearestOrca = orca;
      }
    }
    const perceivedThreat = creature.perceivedStates.get(nearestOrca.id)?.perceivedThreat ?? 0.4;

    candidates.push(
      finalize(
        "flee",
        creature.zone,
        nearestOrca.id,
        {
          threat: perceivedThreat * 1.2,
          trait: traitTerm(creature, (t) => t.caution * 0.5 - t.courage * 0.3),
          skill: skillTerm(creature, creature.skills.evasion),
          emotion: fearTerm(creature) * 0.5,
          intention: intentionTerm(creature, undefined, nearestOrca.id, false),
        },
        rng,
        noiseMax,
      ),
    );

    if (ageStage !== "juvenile") {
      const { display_vigor_cost_pct_energy } = constants.signaling;
      candidates.push(
        finalize(
          "display_vigor",
          creature.zone,
          nearestOrca.id,
          {
            trait: traitTerm(creature, (t) => t.expressiveness * 0.6 + t.courage * 0.2),
            threat: perceivedThreat * 0.3,
            cost: -display_vigor_cost_pct_energy * creature.needs.energy,
          },
          rng,
          noiseMax,
        ),
      );
    }

    pushAlarmCall(candidates, ctx, perceivedThreat, noiseMax);
  } else {
    // Ложная тревога ради конкурентного доступа к еде (7.8.2/7.8.7) — тот
    // же список слагаемых U(a), без хищника рядом просто отсутствует
    // threat-компонента; голод/агрессия/низкая осторожность создают
    // собственный, самостоятельный стимул подать сигнал. Доступно и
    // детёнышу (7.9: "детёныш может кричать тревогу").
    pushAlarmCall(candidates, ctx, 0, noiseMax);
  }

  // socialize / approach(friend) / court(partner)
  const penguinsVisible = visible.filter((v) => v.species === "penguin" && v.id !== creature.id);
  if (penguinsVisible.length > 0) {
    candidates.push(
      finalize(
        "socialize",
        creature.zone,
        undefined,
        {
          need: needTerm(creature, { social: creature.needs.social }),
          trait: traitTerm(creature, (t) => t.sociability * 0.5),
          skill: skillTerm(creature, creature.skills.socializing),
          emotion: playfulTerm(creature) * 0.3,
        },
        rng,
        noiseMax,
      ),
    );

    let bestFriend: Creature | undefined;
    let bestFriendStrength = 0;
    for (const other of penguinsVisible) {
      const s = bondStrength(other.id);
      if (s > bestFriendStrength) {
        bestFriendStrength = s;
        bestFriend = other;
      }
    }
    if (bestFriend) {
      candidates.push(
        finalize(
          "approach",
          creature.zone,
          bestFriend.id,
          {
            need: needTerm(creature, { social: creature.needs.social }),
            trait: traitTerm(creature, (t) => t.sociability * 0.4),
            skill: skillTerm(creature, creature.skills.socializing),
            bond: bestFriendStrength * 0.4,
            intention: intentionTerm(creature, undefined, bestFriend.id, false),
          },
          rng,
          noiseMax,
        ),
      );
    }

    if (ageStage === "adult") {
      let bestMate: Creature | undefined;
      let bestMateScore = -Infinity;
      for (const other of penguinsVisible) {
        if (other.sex === creature.sex) continue;
        const otherAgeStage = ageStageFor(other.species, ageWeeksAt(other.bornAtTick, currentTick));
        if (otherAgeStage !== "adult") continue;
        if (isForbiddenPair(creature, other)) continue;
        const score = bondStrength(other.id) - aversionStrength(other.id);
        if (score > bestMateScore) {
          bestMateScore = score;
          bestMate = other;
        }
      }
      if (bestMate) {
        candidates.push(
          finalize(
            "court",
            creature.zone,
            bestMate.id,
            {
              trait: traitTerm(creature, (t) => t.sociability * 0.3 + t.aggression * 0.1 + t.courage * 0.1),
              bond: bondStrength(bestMate.id) * 0.5,
              intention: intentionTerm(creature, undefined, bestMate.id, true),
            },
            rng,
            noiseMax,
          ),
        );
      }
    }
  }

  // guard_offspring / provision (7.9) — только у взрослых с живым потомством в радиусе охраны.
  if (ageStage === "adult") {
    const guardRadius = constants.kinship.offspring_guard_radius_units;
    const offspringNearby = visible.filter(
      (v) =>
        v.species === "penguin" &&
        (v.parentA === creature.id || v.parentB === creature.id) &&
        ageStageFor(v.species, ageWeeksAt(v.bornAtTick, currentTick)) === "juvenile" &&
        distance(creature.pos, v.pos) <= guardRadius,
    );
    if (offspringNearby.length > 0) {
      const offspring = offspringNearby[0];
      candidates.push(
        finalize(
          "guard_offspring",
          creature.zone,
          offspring.id,
          {
            trait: traitTerm(creature, (t) => t.aggression * 0.2 + t.courage * 0.2),
            skill: skillTerm(creature, creature.skills.parenting) * 1.5,
            emotion: fearTerm(creature) * -0.1,
            night: isNight ? 0.2 : 0,
          },
          rng,
          noiseMax,
        ),
      );

      if (creature.needs.hunger <= constants.reproduction.max_hunger_to_mate) {
        candidates.push(
          finalize(
            "provision",
            creature.zone,
            offspring.id,
            {
              skill: skillTerm(creature, creature.skills.parenting) * 1.2,
              trait: traitTerm(creature, (t) => t.sociability * 0.1),
            },
            rng,
            noiseMax,
          ),
        );
      }
    }
  }
}

function pushAlarmCall(candidates: Candidate[], ctx: DecideContext, perceivedThreat: number, noiseMax: number): void {
  const { creature, visible, rng, fishAvailability } = ctx;
  const constants = getSimConstants();
  const feedingZones = Object.keys(constants.world.fish_respawn_per_tick) as ZoneName[];
  const inFeedingZoneWithRivals =
    (feedingZones as string[]).includes(creature.zone) &&
    visible.some((v) => v.species === "penguin" && v.id !== creature.id) &&
    fishAvailability(creature.zone as ZoneName) < 0.5;

  const competitionDrive = inFeedingZoneWithRivals
    ? creature.needs.hunger * (1 - Math.max(0, creature.traits.caution)) * Math.max(0, creature.traits.aggression) * 0.4
    : 0;

  candidates.push(
    finalize(
      "alarm_call",
      creature.zone,
      undefined,
      {
        trait: traitTerm(creature, (t) => t.expressiveness * 0.5),
        threat: perceivedThreat * 0.8,
        competition: competitionDrive,
        cost: -constants.signaling.alarm_call_cost_pct_energy * creature.needs.energy,
      },
      rng,
      noiseMax,
    ),
  );
}

function decideOrcaActions(
  candidates: Candidate[],
  ctx: DecideContext,
  ageStage: AgeStage,
  ageWeeks: number,
  isNight: boolean,
  noiseMax: number,
): void {
  const { creature, visible, bondStrength, rng, currentTick, phase } = ctx;
  const constants = getSimConstants();
  const perceptionRadius = perceptionRadiusFor(creature, phase);

  const preyVisible = visible.filter((v) => v.species === "penguin" && isWaterZone(v.zone));
  if (preyVisible.length > 0) {
    let best: Creature | undefined;
    let bestScore = -Infinity;
    let bestNormDist = 0;
    let bestPerceivedVigor = 0;
    let bestGroupProtected = false;
    let bestIsJuvenile = false;

    for (const prey of preyVisible) {
      const perceivedVigor = creature.perceivedStates.get(prey.id)?.perceivedVigor ?? 0.5;
      const normDist = normalizedDistance(creature, prey, perceptionRadius);
      const nearbyPenguins = preyVisible.filter((p) => p.id !== prey.id && distance(p.pos, prey.pos) <= 40);
      const groupProtected = nearbyPenguins.length + 1 >= 3;
      const isJuvenile = ageStageFor(prey.species, ageWeeksAt(prey.bornAtTick, currentTick)) === "juvenile";

      const boost = ctx.visibilityMultiplier?.(prey.id) ?? 1;
      const score =
        attractiveness(creature, {
          perceivedVigor,
          normalizedDist: normDist,
          groupProtected,
          isJuvenile,
        }) * boost;
      if (score > bestScore) {
        bestScore = score;
        best = prey;
        bestNormDist = normDist;
        bestPerceivedVigor = perceivedVigor;
        bestGroupProtected = groupProtected;
        bestIsJuvenile = isJuvenile;
      }
    }

    if (best) {
      candidates.push(
        finalize(
          "hunt",
          best.zone,
          best.id,
          {
            need: needTerm(creature, { hunger: creature.needs.hunger }),
            skill: skillTerm(creature, creature.skills.hunting),
            trait: traitTerm(creature, (t) => t.aggression * 0.3 + t.courage * 0.2),
            attractiveness: bestScore * 0.5,
            intention: intentionTerm(creature, best.zone, best.id, false),
          },
          rng,
          noiseMax,
        ),
      );

      const preyPerceivedThreatOfMe = best.perceivedStates.get(creature.id)?.perceivedThreat ?? 0;
      if (preyPerceivedThreatOfMe > 0.3) {
        candidates.push(
          finalize(
            "stealth_approach",
            best.zone,
            best.id,
            {
              skill: skillTerm(creature, creature.skills.hunting) * 0.8,
              trait: traitTerm(creature, (t) => t.caution * 0.3 - t.aggression * 0.1),
              wariness: preyPerceivedThreatOfMe * 0.6,
            },
            rng,
            noiseMax,
          ),
        );
      }

      // Партнёр для coordinate_hunt (7.9): "bonds.strength >= 0.4" — тот же
      // порог, что и у дружбы (social.friendship.threshold), переиспользуем
      // константу вместо дублирования числа.
      const coordinationThreshold = constants.social.friendship.threshold;
      const orcasVisible = visible.filter((v) => v.species === "orca" && v.id !== creature.id);
      let bestPartner: Creature | undefined;
      let bestPartnerBond = 0;
      for (const other of orcasVisible) {
        const s = bondStrength(other.id);
        if (s >= coordinationThreshold && s > bestPartnerBond) {
          bestPartnerBond = s;
          bestPartner = other;
        }
      }
      if (bestPartner) {
        candidates.push(
          finalize(
            "coordinate_hunt",
            best.zone,
            best.id,
            {
              skill: skillTerm(creature, creature.skills.hunting),
              trait: traitTerm(creature, (t) => t.sociability * 0.3 + t.aggression * 0.2),
              bond: bestPartnerBond * 0.5,
              groupBonus: bestGroupProtected ? 0.4 : 0,
            },
            rng,
            noiseMax,
          ),
        );
      }
    }
  }

  // socialize / approach / court для касаток — связи функциональны (7.9), но и социально значимы.
  const orcasVisible = visible.filter((v) => v.species === "orca" && v.id !== creature.id);
  if (orcasVisible.length > 0) {
    candidates.push(
      finalize(
        "socialize",
        creature.zone,
        undefined,
        {
          need: needTerm(creature, { social: creature.needs.social }),
          trait: traitTerm(creature, (t) => t.sociability * 0.5),
          skill: skillTerm(creature, creature.skills.socializing),
        },
        rng,
        noiseMax,
      ),
    );

    if (ageStage === "adult") {
      let bestMate: Creature | undefined;
      let bestMateScore = -Infinity;
      for (const other of orcasVisible) {
        if (other.sex === creature.sex) continue;
        const otherAgeStage = ageStageFor(other.species, ageWeeksAt(other.bornAtTick, currentTick));
        if (otherAgeStage !== "adult") continue;
        if (isForbiddenPair(creature, other)) continue;
        const score = bondStrength(other.id);
        if (score > bestMateScore) {
          bestMateScore = score;
          bestMate = other;
        }
      }
      if (bestMate) {
        candidates.push(
          finalize(
            "court",
            creature.zone,
            bestMate.id,
            {
              trait: traitTerm(creature, (t) => t.sociability * 0.3),
              bond: bondStrength(bestMate.id) * 0.5,
            },
            rng,
            noiseMax,
          ),
        );
      }
    }
  }
}
