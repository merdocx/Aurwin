import type { Pool } from "pg";
import { loadConstants } from "../constants.js";

/** TTL decision_log (А.2, decision_log.ttl_days = 7 суток, А.9). */
export async function cleanupDecisionLog(pool: Pool): Promise<number> {
  const constants = loadConstants();
  const ttlDays = constants.decision_log.ttl_days as number;

  const result = await pool.query(
    `DELETE FROM decision_log WHERE created_at < now() - ($1::text || ' days')::interval`,
    [ttlDays],
  );
  return result.rowCount ?? 0;
}
