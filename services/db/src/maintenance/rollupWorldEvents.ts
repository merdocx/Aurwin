import type { Pool } from "pg";
import { loadConstants } from "../constants.js";

/**
 * world_events: полные retention.world_events_full_days (90) суток, далее
 * сворачиваются в суточные агрегаты (world_events_daily_agg) вместо
 * построчного хранения. ТЗ А.2.
 */
export async function rollupWorldEvents(pool: Pool): Promise<number> {
  const constants = loadConstants();
  const fullDays = constants.retention.world_events_full_days as number;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
      INSERT INTO world_events_daily_agg (day, type, count)
      SELECT date_trunc('day', created_at)::date, type, count(*)
      FROM world_events
      WHERE created_at < now() - ($1::text || ' days')::interval
      GROUP BY 1, 2
      ON CONFLICT (day, type) DO UPDATE
        SET count = world_events_daily_agg.count + EXCLUDED.count
      `,
      [fullDays],
    );
    const deleted = await client.query(
      `DELETE FROM world_events WHERE created_at < now() - ($1::text || ' days')::interval`,
      [fullDays],
    );
    await client.query("COMMIT");
    return deleted.rowCount ?? 0;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
