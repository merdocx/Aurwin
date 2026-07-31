import { Pool } from "pg";

/**
 * Пул подключений к Postgres — та же логика, что и services/db/src/pool.ts
 * (строка подключения только из окружения, CLAUDE.md п.1). Продублировано,
 * а не импортировано из @aurwin/db, по тому же принципу, что и
 * world/constants.ts дублирует загрузку constants.yaml вместо кросс-сервисной
 * зависимости: каждый Dockerfile копирует только свой services/<name>, без
 * services/db целиком.
 */
export function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  return connectionString ? new Pool({ connectionString }) : new Pool();
}
