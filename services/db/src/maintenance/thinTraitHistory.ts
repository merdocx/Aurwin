import type { Pool } from "pg";
import { loadConstants } from "../constants.js";

/**
 * Прореживание trait_history после смерти существа (А.2): оставляем birth +
 * первую/последнюю запись + не чаще 1 записи в сутки жизни. "Сутки жизни"
 * считаются как реальные сутки существования (tick <-> реальное время через
 * time.visual_tick_seconds, поскольку визуальный тик = фиксированный
 * реальный интервал независимо от ускорения биочасов).
 */
export async function thinTraitHistory(pool: Pool): Promise<number> {
  const constants = loadConstants();
  const visualTickSeconds = constants.time.visual_tick_seconds as number;
  const ticksPerDay = 86400 / visualTickSeconds;

  const result = await pool.query(
    `
    WITH candidates AS (
      -- birth исключается из окна намеренно: иначе она занимает rn=1 в своём
      -- дне и вытесняет реальную первую reflection-запись под удаление.
      SELECT th.ctid, th.creature_id, th.tick
      FROM trait_history th
      JOIN creatures c ON c.id = th.creature_id
      WHERE c.died_at_tick IS NOT NULL AND th.source <> 'birth'
    ),
    ranked AS (
      SELECT ctid,
             row_number() OVER (
               PARTITION BY creature_id, floor(tick / $1::float8)
               ORDER BY tick ASC
             ) AS bucket_rn,
             tick = min(tick) OVER (PARTITION BY creature_id) AS is_first,
             tick = max(tick) OVER (PARTITION BY creature_id) AS is_last
      FROM candidates
    )
    DELETE FROM trait_history
    WHERE ctid IN (
      SELECT ctid FROM ranked WHERE NOT is_first AND NOT is_last AND bucket_rn > 1
    )
    `,
    [ticksPerDay],
  );
  return result.rowCount ?? 0;
}
