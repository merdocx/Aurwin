import type { Pool } from "pg";
import { loadConstants } from "../constants.js";

/**
 * signals: полные retention.signals_full_days (30) суток, далее только
 * агрегаты (доля неподтверждённых сигналов по видам, signals_daily_agg). ТЗ А.2.
 */
export async function rollupSignals(pool: Pool): Promise<number> {
  const constants = loadConstants();
  const fullDays = constants.retention.signals_full_days as number;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
      INSERT INTO signals_daily_agg (day, species, type, total, disconfirmed)
      SELECT date_trunc('day', s.created_at)::date, c.species, s.type,
             count(*), count(*) FILTER (WHERE s.outcome = 'disconfirmed')
      FROM signals s
      JOIN creatures c ON c.id = s.sender_id
      WHERE s.created_at < now() - ($1::text || ' days')::interval
      GROUP BY 1, 2, 3
      ON CONFLICT (day, species, type) DO UPDATE
        SET total = signals_daily_agg.total + EXCLUDED.total,
            disconfirmed = signals_daily_agg.disconfirmed + EXCLUDED.disconfirmed
      `,
      [fullDays],
    );
    const deleted = await client.query(
      `DELETE FROM signals WHERE created_at < now() - ($1::text || ' days')::interval`,
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
