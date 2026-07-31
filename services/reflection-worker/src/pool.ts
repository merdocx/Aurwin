import { Pool } from "pg";

/**
 * Пул подключений к Postgres — строка подключения только из окружения
 * (CLAUDE.md, «Незыблемые правила», п.1). Продублировано из
 * services/sim-engine/src/persistence/pool.ts по тому же принципу
 * независимости Docker-контекстов сервисов (см. ops/DEVIATIONS.md, фаза 6).
 */
export function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  return connectionString ? new Pool({ connectionString }) : new Pool();
}
