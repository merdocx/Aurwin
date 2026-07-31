import { Pool } from "pg";

/**
 * Пул подключений к Postgres — та же логика, что и services/db/src/pool.ts
 * (строка подключения только из окружения, CLAUDE.md п.1). Продублировано
 * по тому же принципу, что и в sim-engine (см. services/sim-engine/src/
 * persistence/pool.ts) — каждый Dockerfile копирует только свой сервис.
 * api-gateway — ТОЛЬКО читатель БД (А.1): нигде в этом сервисе не должно
 * быть INSERT/UPDATE/DELETE по игровому состоянию.
 */
export function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  return connectionString ? new Pool({ connectionString }) : new Pool();
}
