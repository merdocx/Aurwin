import type { Pool } from "pg";
import { ecoZoneAtSim } from "../world/landMask.js";
import type { ZoneName } from "../world/zones.js";
import { ageStageFor, ageWeeksAt } from "../sim/lifecycle.js";
import { seedInstincts } from "../sim/instincts.js";
import { Rng } from "../sim/rng.js";
import type { AversionRecord, BondRecord, Creature, Episode, Instincts, PerceivedState, SignalTrustEntry } from "../sim/types.js";
import type { RestoredWorldState } from "../sim/simulation.js";

/**
 * Восстановление мира после рестарта sim-engine (А.7, фаза 7): читает
 * последний записанный tick/phase (world_clock) и живых существ + bonds +
 * aversions. Возвращает null при первом запуске (world_clock ещё пуст) —
 * тогда index.ts проводит genesis, как раньше.
 *
 * RAM-поля actionCounts, cohortId (получает новый "restored"-когорту),
 * continuousStarvationRealHours,
 * awakeSinceTick, lastAction, velocity. `lastReproducedAtTick` и
 * `fishDensity` восстанавливаются с P3 (migration 015). Эпизоды и
 * сигнальные восприятия восстанавливаются из последнего полного снапшота.
 * Тело существа (черты, навыки, веса,
 * потребности, self-narrative, позиция) восстанавливается полностью — это
 * то, что определяет идентичность и историю особи для наблюдателя.
 */
/**
 * Защита от повторного genesis (см. persistGenesis в persist.ts): world_clock
 * пустой ДОЛЖЕН означать "мира ещё не было вообще", а не "world_clock отстал
 * от creatures". Раньше единственным критерием холодного старта был пустой
 * world_clock — этого было достаточно только при условии, что creatures и
 * world_clock всегда пишутся вместе; persistGenesis это теперь гарантирует
 * транзакцией, но index.ts всё равно сверяется с этой функцией как со вторым,
 * независимым сигналом (defense in depth) — если она когда-либо вернёт true
 * при пустом world_clock, это укажет на состояние, повреждённое НЕ через
 * штатный путь persistGenesis (например, ручную правку БД), и genesis
 * запускать нельзя ни в коем случае (правило "genesis ровно один раз за всю
 * жизнь мира").
 */
export async function hasAnyCreatureRecord(pool: Pool): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM creatures LIMIT 1`);
  return (result.rowCount ?? 0) > 0;
}

export async function loadWorldState(pool: Pool): Promise<RestoredWorldState & { phase: "day" | "night" } | null> {
  const clockResult = await pool.query<{ tick: string; phase: "day" | "night"; fish_density: Record<string, number> | null }>(
    `SELECT tick, phase, fish_density FROM world_clock WHERE id = 1`,
  );
  if (clockResult.rowCount === 0) return null;
  const tick = Number(clockResult.rows[0].tick);
  const phase = clockResult.rows[0].phase;
  const rawFish = clockResult.rows[0].fish_density;
  const fishDensity =
    rawFish && typeof rawFish === "object"
      ? {
          north_bay: Number(rawFish.north_bay ?? 1),
          south_shallows: Number(rawFish.south_shallows ?? 1),
        }
      : undefined;

  const creaturesResult = await pool.query(`
    SELECT id, species, name, sex, born_at_tick, parent_a, parent_b, pos_x, pos_y, zone,
           traits, traits_birth, needs, emotion, intentions, narrative, narrative_facts,
           skills, chronotype, is_asleep, activity, authority, habits, instincts, weights, weights_birth,
           last_reflection_at, last_reproduced_at_tick, continuous_starvation_real_hours
    FROM creatures WHERE died_at_tick IS NULL
  `);

  const creatures: Creature[] = creaturesResult.rows.map((row): Creature => {
    const bornAtTick = Number(row.born_at_tick);
    const pos = { x: row.pos_x, y: row.pos_y };
    const zone = ecoZoneAtSim(pos.x, pos.y);
    return {
      id: row.id,
      species: row.species,
      name: row.name,
      sex: row.sex,
      bornAtTick,
      parentA: row.parent_a ?? undefined,
      parentB: row.parent_b ?? undefined,
      pos,
      velocity: { x: 0, y: 0 },
      zone,
      traits: row.traits,
      traitsBirth: row.traits_birth,
      needs: row.needs,
      emotion: row.emotion,
      intentions: row.intentions ?? [],
      narrative: row.narrative ?? undefined,
      skills: row.skills,
      chronotype: row.chronotype,
      isAsleep: row.is_asleep,
      activity: row.activity ?? "idle",
      ageStage: ageStageFor(row.species, ageWeeksAt(bornAtTick, tick)),
      authority: row.authority,
      habits: row.habits ?? {},
      instincts: (row.instincts as Instincts | null | undefined) ?? seedInstincts(row.species, row.traits, new Rng(bornAtTick ^ tick)),
      weights: row.weights,
      weightsBirth: row.weights_birth,
      lastReflectionAt: Number(row.last_reflection_at ?? tick),
      lastReproducedAtTick: row.last_reproduced_at_tick != null ? Number(row.last_reproduced_at_tick) : undefined,
      continuousStarvationRealHours: Number(row.continuous_starvation_real_hours ?? 0),
      awakeSinceTick: tick,
      episodes: [],
      perceivedStates: new Map(),
      perceivedZoneThreat: new Map(),
      trust: new Map(),
      cohortId: `${row.species}-restored-${tick}`,
      actionCounts: {},
      narrativeFacts: row.narrative_facts ?? [],
    };
  });
  const creaturesById = new Map(creatures.map((creature) => [creature.id, creature]));

  const [episodesResult, perceivedStatesResult, zoneThreatResult, trustResult] = await Promise.all([
    pool.query<{
      id: string;
      creature_id: string;
      tick: string;
      type: Episode["type"];
      participants: string[] | null;
      significance: number;
      consumed_by_reflection: boolean;
      learned_from: string | null;
      transmission_depth: number;
      core_memory: boolean;
    }>(
      `WITH ranked_episodes AS (
         SELECT e.*,
                row_number() OVER (PARTITION BY e.creature_id ORDER BY e.tick DESC, e.id DESC) AS recency_rank
         FROM episodes AS e
         JOIN creatures AS c ON c.id = e.creature_id
         WHERE c.died_at_tick IS NULL
       )
       SELECT id, creature_id, tick, type, participants, significance, consumed_by_reflection,
              learned_from, transmission_depth, core_memory
       FROM ranked_episodes
       WHERE recency_rank <= 50 OR NOT consumed_by_reflection OR core_memory
       ORDER BY creature_id, tick, id`,
    ),
    pool.query<{
      observer_id: string;
      subject_id: string;
      perceived_vigor: number;
      perceived_threat: number;
      last_signal_tick: string | null;
    }>(
      `SELECT ps.observer_id, ps.subject_id, ps.perceived_vigor, ps.perceived_threat, ps.last_signal_tick
       FROM perceived_states AS ps
       JOIN creatures AS observer ON observer.id = ps.observer_id AND observer.died_at_tick IS NULL
       JOIN creatures AS subject ON subject.id = ps.subject_id AND subject.died_at_tick IS NULL`,
    ),
    pool.query<{ observer_id: string; zone: ZoneName; threat: number }>(
      `SELECT pzt.observer_id, pzt.zone, pzt.threat
       FROM perceived_zone_threat AS pzt
       JOIN creatures AS observer ON observer.id = pzt.observer_id AND observer.died_at_tick IS NULL`,
    ),
    pool.query<{
      observer_id: string;
      signaler_id: string;
      trust: number;
      confirmations: number;
      disconfirmations: number;
    }>(
      `SELECT st.observer_id, st.signaler_id, st.trust, st.confirmations, st.disconfirmations
       FROM signal_trust AS st
       JOIN creatures AS observer ON observer.id = st.observer_id AND observer.died_at_tick IS NULL
       JOIN creatures AS signaler ON signaler.id = st.signaler_id AND signaler.died_at_tick IS NULL`,
    ),
  ]);

  for (const row of episodesResult.rows) {
    const creature = creaturesById.get(row.creature_id);
    if (!creature) continue;
    const episode: Episode = {
      id: row.id,
      creatureId: row.creature_id,
      tick: Number(row.tick),
      type: row.type,
      participants: row.participants ?? [],
      significance: Number(row.significance),
      consumedByReflection: row.consumed_by_reflection,
      learnedFrom: row.learned_from ?? undefined,
      transmissionDepth: Number(row.transmission_depth),
      coreMemory: row.core_memory,
    };
    creature.episodes.push(episode);
  }

  for (const row of perceivedStatesResult.rows) {
    const observer = creaturesById.get(row.observer_id);
    if (!observer) continue;
    const state: PerceivedState = {
      perceivedVigor: Number(row.perceived_vigor),
      perceivedThreat: Number(row.perceived_threat),
      lastSignalTick: row.last_signal_tick === null ? Number.NEGATIVE_INFINITY : Number(row.last_signal_tick),
    };
    observer.perceivedStates.set(row.subject_id, state);
  }

  for (const row of zoneThreatResult.rows) {
    const observer = creaturesById.get(row.observer_id);
    if (observer) observer.perceivedZoneThreat.set(row.zone, Number(row.threat));
  }

  for (const row of trustResult.rows) {
    const observer = creaturesById.get(row.observer_id);
    if (!observer) continue;
    const entry: SignalTrustEntry = {
      trust: Number(row.trust),
      confirmations: Number(row.confirmations),
      disconfirmations: Number(row.disconfirmations),
    };
    observer.trust.set(row.signaler_id, entry);
  }

  const bondsResult = await pool.query(`SELECT creature_a, creature_b, kind, strength FROM bonds`);
  const bonds: BondRecord[] = bondsResult.rows.map((row) => ({
    creatureA: row.creature_a,
    creatureB: row.creature_b,
    kind: row.kind,
    strength: row.strength,
  }));

  const aversionsResult = await pool.query(`SELECT subject_id, object_id, strength FROM aversions`);
  const aversions: AversionRecord[] = aversionsResult.rows.map((row) => ({
    subjectId: row.subject_id,
    objectId: row.object_id,
    strength: row.strength,
  }));

  const deadNamesResult = await pool.query<{ name: string; species: "penguin" | "orca" }>(
    `SELECT name, species FROM creatures
     WHERE died_at_tick IS NOT NULL
     ORDER BY died_at_tick DESC NULLS LAST
     LIMIT 400`,
  );
  const occupiedNames = deadNamesResult.rows.map((row) => ({ name: row.name, species: row.species }));

  return { tick, phase, creatures, bonds, aversions, fishDensity, occupiedNames };
}
