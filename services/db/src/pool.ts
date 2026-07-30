import { Pool } from "pg";

/**
 * Пул подключений к Postgres. Строка подключения читается только из
 * окружения (DATABASE_URL) либо из стандартных переменных libpq (PGHOST,
 * PGPORT, PGUSER, PGPASSWORD, PGDATABASE), которые `pg` подхватывает сам,
 * если Pool создаётся без аргументов (CLAUDE.md, «Незыблемые правила», п.1).
 */
export function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  return connectionString ? new Pool({ connectionString }) : new Pool();
}
