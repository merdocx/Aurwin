import type { Pool } from "pg";
import { loadConstants } from "../constants.js";

export interface PruneEpisodesResult {
  decayed: number;
  deletedOverCap: number;
  deletedAfterDeath: number;
}

/**
 * Прунинг эпизодической памяти (А.2, "Прунинг"):
 *  1) затухание significance: s *= decay_rate ^ (реальные сутки с последнего затухания);
 *  2) лимит по виду (memory.episodic_limit): при превышении удаляются сначала
 *     consumed_by_reflection с наименьшей significance, core_memory не трогаем;
 *  3) полное удаление эпизодов существа через retention.episodes_days_after_death
 *     реальных суток после его смерти.
 */
export async function pruneEpisodes(pool: Pool): Promise<PruneEpisodesResult> {
  const constants = loadConstants();
  const decayPenguin = constants.memory.significance_decay_per_day.penguin as number;
  const decayOrca = constants.memory.significance_decay_per_day.orca as number;
  const capPenguin = constants.memory.episodic_limit.penguin as number;
  const capOrca = constants.memory.episodic_limit.orca as number;
  const daysAfterDeath = constants.retention.episodes_days_after_death as number;

  const decayResult = await pool.query(
    `
    UPDATE episodes e
    SET significance = e.significance * power(
          CASE c.species WHEN 'penguin' THEN $1::real ELSE $2::real END,
          GREATEST(0, EXTRACT(EPOCH FROM (now() - e.decayed_at)) / 86400)
        ),
        decayed_at = now()
    FROM creatures c
    WHERE c.id = e.creature_id AND e.decayed_at < now()
    `,
    [decayPenguin, decayOrca],
  );

  const capResult = await pool.query(
    `
    WITH ranked AS (
      SELECT e.id,
             row_number() OVER (
               PARTITION BY e.creature_id
               ORDER BY e.consumed_by_reflection DESC, e.significance ASC
             ) AS rn,
             count(*) OVER (PARTITION BY e.creature_id) AS total,
             CASE c.species WHEN 'penguin' THEN $1::int ELSE $2::int END AS cap
      FROM episodes e
      JOIN creatures c ON c.id = e.creature_id
      WHERE e.core_memory = FALSE
    )
    DELETE FROM episodes
    WHERE id IN (
      SELECT id FROM ranked WHERE total > cap AND rn <= (total - cap)
    )
    `,
    [capPenguin, capOrca],
  );

  const deathResult = await pool.query(
    `
    DELETE FROM episodes e
    USING creatures c
    WHERE c.id = e.creature_id
      AND c.died_at IS NOT NULL
      AND c.died_at < now() - ($1::text || ' days')::interval
    `,
    [daysAfterDeath],
  );

  return {
    decayed: decayResult.rowCount ?? 0,
    deletedOverCap: capResult.rowCount ?? 0,
    deletedAfterDeath: deathResult.rowCount ?? 0,
  };
}
