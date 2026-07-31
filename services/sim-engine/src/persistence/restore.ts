import type { Pool } from "pg";
import { zoneAt } from "../world/zones.js";
import { ageStageFor, ageWeeksAt } from "../sim/lifecycle.js";
import type { AversionRecord, BondRecord, Creature } from "../sim/types.js";
import type { RestoredWorldState } from "../sim/simulation.js";

/**
 * Восстановление мира после рестарта sim-engine (А.7, фаза 7): читает
 * последний записанный tick/phase (world_clock) и живых существ + bonds +
 * aversions. Возвращает null при первом запуске (world_clock ещё пуст) —
 * тогда index.ts проводит genesis, как раньше.
 *
 * Не восстанавливается (см. ops/DEVIATIONS.md, фаза 7 — сознательный пробел,
 * не персистентный ни в одной фазе до этой): episodes, perceivedStates,
 * perceivedZoneThreat, trust, actionCounts, cohortId (получает новый,
 * "restored"-когорту), lastReproducedAtTick, continuousStarvationRealHours,
 * awakeSinceTick, lastAction, velocity. Тело существа (черты, навыки, веса,
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
  const clockResult = await pool.query<{ tick: string; phase: "day" | "night" }>(
    `SELECT tick, phase FROM world_clock WHERE id = 1`,
  );
  if (clockResult.rowCount === 0) return null;
  const tick = Number(clockResult.rows[0].tick);
  const phase = clockResult.rows[0].phase;

  const creaturesResult = await pool.query(`
    SELECT id, species, name, sex, born_at_tick, parent_a, parent_b, pos_x, pos_y, zone,
           traits, traits_birth, needs, emotion, intentions, narrative, narrative_facts,
           skills, chronotype, is_asleep, authority, habits, weights, weights_birth, last_reflection_at
    FROM creatures WHERE died_at_tick IS NULL
  `);

  const creatures: Creature[] = creaturesResult.rows.map((row): Creature => {
    const bornAtTick = Number(row.born_at_tick);
    const pos = { x: row.pos_x, y: row.pos_y };
    const zone = row.zone ?? zoneAt(pos.x, pos.y).name;
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
      ageStage: ageStageFor(row.species, ageWeeksAt(bornAtTick, tick)),
      authority: row.authority,
      habits: row.habits ?? {},
      weights: row.weights,
      weightsBirth: row.weights_birth,
      lastReflectionAt: Number(row.last_reflection_at ?? tick),
      continuousStarvationRealHours: 0,
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

  return { tick, phase, creatures, bonds, aversions };
}
