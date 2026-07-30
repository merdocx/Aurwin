import type { Pool } from "pg";
import { loadConstants } from "../constants.js";

/**
 * Обнуление request/response в reflections через retention.reflections_audit_days
 * (аудит промптов не нужен вечно); метаданные (kind, status, created_at,
 * applied_at) остаются нетронутыми. ТЗ А.2.
 */
export async function redactReflections(pool: Pool): Promise<number> {
  const constants = loadConstants();
  const auditDays = constants.retention.reflections_audit_days as number;

  const result = await pool.query(
    `
    UPDATE reflections
    SET request = NULL, response = NULL
    WHERE created_at < now() - ($1::text || ' days')::interval
      AND (request IS NOT NULL OR response IS NOT NULL)
    `,
    [auditDays],
  );
  return result.rowCount ?? 0;
}
