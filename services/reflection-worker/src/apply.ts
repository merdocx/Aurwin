import type { Pool, PoolClient } from "pg";
import { getConstants } from "./constants.js";
import { TRAIT_KEYS, type Traits } from "./types.js";
import type { ResolvedIntention, ValidatedReflection } from "./validate.js";

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Дельты черт характера (7.3, А.3 шаг 1): двойное ограничение —
 * (а) clamp ±reflection.trait_delta_clamp за ОДНУ рефлексию;
 * (б) пожизненный коридор ±reflection.trait_lifetime_corridor от traits_birth.
 * Идентично по смыслу services/sim-engine/src/sim/reflection.ts::applyTraitDeltas
 * (продублировано намеренно — reflection-worker не импортирует sim-engine,
 * см. ops/DEVIATIONS.md, фаза 6), но оперирует "сырыми" JSONB-объектами из
 * Postgres, а не in-memory типом Creature.
 */
export function applyTraitDeltas(
  traits: Traits,
  traitsBirth: Traits,
  deltas: Partial<Record<string, number>>,
  clamp: number,
  corridor: number,
): Traits {
  const result: Traits = { ...traits };
  for (const key of TRAIT_KEYS) {
    const delta = deltas[key];
    if (delta === undefined) continue;
    const clampedDelta = clampNumber(delta, -clamp, clamp);
    const birth = traitsBirth[key];
    const proposed = traits[key] + clampedDelta;
    const min = Math.max(-1, birth - corridor);
    const max = Math.min(1, birth + corridor);
    result[key] = clampNumber(proposed, min, max);
  }
  return result;
}

/** То же для индивидуальных весов U(a) (7.7, механизм 4) — коридор ±weight_lifetime_corridor от врождённого. */
export function applyWeightDeltas(
  weights: Record<string, unknown>,
  weightsBirth: Record<string, unknown>,
  deltas: Record<string, number>,
  clamp: number,
  corridor: number,
): Record<string, unknown> {
  const result = structuredClone(weights);
  for (const [path, rawDelta] of Object.entries(deltas)) {
    const clampedDelta = clampNumber(rawDelta, -clamp, clamp);
    const segments = path.split(".");
    if (segments.length === 1) {
      const key = segments[0];
      const birth = weightsBirth[key] as number | undefined;
      const current = result[key] as number | undefined;
      if (typeof birth !== "number" || typeof current !== "number") continue;
      const min = birth - corridor;
      const max = birth + corridor;
      result[key] = clampNumber(current + clampedDelta, min, max);
    } else if (segments.length === 2) {
      const [group, key] = segments;
      const birthGroup = weightsBirth[group] as Record<string, number> | undefined;
      const currentGroup = result[group] as Record<string, number> | undefined;
      if (!birthGroup || !currentGroup || typeof birthGroup[key] !== "number" || typeof currentGroup[key] !== "number") continue;
      const birth = birthGroup[key];
      const min = birth - corridor;
      const max = birth + corridor;
      currentGroup[key] = clampNumber(currentGroup[key] + clampedDelta, min, max);
    }
  }
  return result;
}

/** Обратно в форму, которую понимает sim-engine (effect.approach_bonus.creature — id, А.2/utilityAI.ts). */
function intentionsToDbJson(intentions: ResolvedIntention[]): unknown {
  return intentions.map((intention) => {
    const effect: Record<string, unknown> = {};
    if (intention.effect.zone_penalty) effect.zone_penalty = intention.effect.zone_penalty;
    if (intention.effect.zone_bonus) effect.zone_bonus = intention.effect.zone_bonus;
    if (intention.effect.approach_bonus) effect.approach_bonus = { creature: intention.effect.approach_bonus.creatureId, value: intention.effect.approach_bonus.value };
    if (intention.effect.avoid_creature) effect.avoid_creature = { creature: intention.effect.avoid_creature.creatureId, value: intention.effect.avoid_creature.value };
    if (intention.effect.seek_mate !== undefined) effect.seek_mate = intention.effect.seek_mate;
    return { text: intention.text, effect };
  });
}

export interface ApplyOutcome {
  applied: boolean;
  reason?: "creature_not_found" | "creature_dead";
}

async function markEpisodesConsumed(client: PoolClient, episodeIds: string[]): Promise<void> {
  if (episodeIds.length === 0) return;
  await client.query(`UPDATE episodes SET consumed_by_reflection = TRUE WHERE id = ANY($1::uuid[])`, [episodeIds]);
}

/**
 * Применяет валидированный результат рефлексии транзакционно (А.3, шаг 1
 * пайплайна sim-engine — здесь то же самое действие, выполненное со стороны
 * reflection-worker при прямой записи в `creatures`, см. ops/DEVIATIONS.md,
 * фаза 6 про разделение ответственности между процессами). ВСЯ работа идёт
 * через ОДИН client в ОДНОЙ транзакции — иначе гонка между `SELECT ...
 * FOR UPDATE` и записью результата в отдельных соединениях могла бы
 * применить дельты поверх состояния, которое уже устарело к моменту commit:
 *  - существо ЖИВО (died_at_tick IS NULL) -> дельты черт/весов применяются
 *    с clamp+коридором, narrative/narrative_facts/intentions заменяются,
 *    last_reflection_at обновляется, reflections.status = 'applied';
 *  - существо УМЕРЛО (died_at_tick IS NOT NULL) или не найдено -> результат
 *    ОТБРАСЫВАЕТСЯ (7.3: "висящая" рефлексия), но narrative сохраняется как
 *    "последняя мысль" в world_events (type='last_thought') для ленты
 *    наблюдателя; reflections.status = 'discarded'.
 * В обоих случаях эпизоды, вошедшие в этот вызов, помечаются consumed
 * (они уже "осмыслены" — не должны попасть в следующий merge).
 */
export async function applyReflectionResult(
  pool: Pool,
  params: {
    reflectionId: string;
    creatureId: string;
    mergedEpisodeIds: string[];
    currentTick: number;
    validated: ValidatedReflection;
  },
): Promise<ApplyOutcome> {
  const constants = getConstants().reflection;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ traits: Traits; traits_birth: Traits; weights: Record<string, unknown>; weights_birth: Record<string, unknown>; died_at_tick: string | number | null }>(
      `SELECT traits, traits_birth, weights, weights_birth, died_at_tick FROM creatures WHERE id = $1 FOR UPDATE`,
      [params.creatureId],
    );
    const row = result.rows[0];

    if (!row || row.died_at_tick !== null) {
      // "Последняя мысль" (7.3) имеет смысл только если существо реально
      // существовало (actor_id -> world_events ссылается на creatures.id,
      // FK) — полностью неизвестный creature_id (гонка/ошибка выше по
      // стеку) просто отбрасывается без ленты событий.
      if (row) {
        await client.query(`INSERT INTO world_events (tick, type, actor_id, payload) VALUES ($1, 'last_thought', $2, $3)`, [
          params.currentTick,
          params.creatureId,
          JSON.stringify({ text: params.validated.narrative }),
        ]);
      }
      await client.query(`UPDATE reflections SET status = 'discarded', applied_at = now() WHERE id = $1`, [params.reflectionId]);
      await markEpisodesConsumed(client, params.mergedEpisodeIds);
      await client.query("COMMIT");
      return { applied: false, reason: row ? "creature_dead" : "creature_not_found" };
    }

    const newTraits = applyTraitDeltas(row.traits, row.traits_birth, params.validated.traitDeltas, constants.trait_delta_clamp, constants.trait_lifetime_corridor);
    const newWeights = applyWeightDeltas(row.weights, row.weights_birth, params.validated.weightDeltas, constants.weight_delta_clamp, constants.weight_lifetime_corridor);
    const intentionsJson = intentionsToDbJson(params.validated.intentions);

    await client.query(
      `UPDATE creatures SET traits = $2, weights = $3, narrative = $4, narrative_facts = $5, intentions = $6, last_reflection_at = $7
       WHERE id = $1`,
      [
        params.creatureId,
        JSON.stringify(newTraits),
        JSON.stringify(newWeights),
        params.validated.narrative,
        JSON.stringify(params.validated.narrativeFacts),
        JSON.stringify(intentionsJson),
        params.currentTick,
      ],
    );
    await client.query(`UPDATE reflections SET status = 'applied', applied_at = now() WHERE id = $1`, [params.reflectionId]);
    await markEpisodesConsumed(client, params.mergedEpisodeIds);
    await client.query("COMMIT");
    return { applied: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
