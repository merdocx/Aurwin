import type { Pool } from "pg";
import type { Creature, Intention } from "../sim/types.js";

/**
 * Живая синхронизация полей, которыми владеет reflection-worker (фаза 6+):
 * sim-engine перечитывает их из Postgres без рестарта процесса, чтобы utility
 * AI использовал актуальные черты/веса/намерения после apply.ts.
 *
 * Полный снапшот sim-engine по-прежнему НЕ перезаписывает эти колонки
 * (REFLECTION_OWNED_COLUMNS в persist.ts) — единственный писатель в БД
 * остаётся reflection-worker; здесь только чтение в in-memory Creature.
 */

interface ReflectionRow {
  id: string;
  traits: Creature["traits"];
  weights: Creature["weights"];
  intentions: Intention[] | null;
  narrative_facts: string[] | null;
  narrative: string | null;
  last_reflection_at: string;
}

/** Watermark для `last_reflection_at > $lastSync` — max среди уже загруженных особей. */
export function reflectionSyncWatermark(creatures: Iterable<Creature>): number {
  let max = 0;
  for (const c of creatures) {
    if (c.lastReflectionAt > max) max = c.lastReflectionAt;
  }
  return max;
}

/**
 * SELECT изменившихся живых существ и применение reflection-owned полей к Map.
 * Возвращает обновлённый watermark (max last_reflection_at среди применённых строк).
 */
export async function reloadReflectionFields(
  pool: Pool,
  creatures: Map<string, Creature>,
  lastSyncAt: number,
): Promise<number> {
  const result = await pool.query<ReflectionRow>(
    `SELECT id, traits, weights, intentions, narrative_facts, narrative, last_reflection_at
     FROM creatures
     WHERE died_at_tick IS NULL AND last_reflection_at > $1`,
    [lastSyncAt],
  );

  let watermark = lastSyncAt;
  for (const row of result.rows) {
    const creature = creatures.get(row.id);
    if (!creature) continue;

    creature.traits = row.traits;
    creature.weights = row.weights;
    creature.intentions = row.intentions ?? [];
    creature.narrativeFacts = row.narrative_facts ?? [];
    creature.narrative = row.narrative ?? undefined;

    const at = Number(row.last_reflection_at);
    creature.lastReflectionAt = at;
    if (at > watermark) watermark = at;
  }

  return watermark;
}
