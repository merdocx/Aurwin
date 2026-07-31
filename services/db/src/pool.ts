import { Pool } from "pg";

/**
 * Пул подключений к Postgres. Строка подключения читается только из
 * окружения (DATABASE_URL) либо из стандартных переменных libpq (PGHOST,
 * PGPORT, PGUSER, PGPASSWORD, PGDATABASE), которые `pg` подхватывает сам,
 * если Pool создаётся без аргументов (CLAUDE.md, «Незыблемые правила», п.1).
 */
export function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  const pool = connectionString ? new Pool({ connectionString }) : new Pool();
  // См. тот же фикс/обоснование в services/sim-engine/src/persistence/pool.ts
  // (фаза 7): без слушателя "error" разрыв простаивающего соединения валит
  // процесс необработанным событием, а не только текущий запрос.
  pool.on("error", (err) => {
    console.error("[db] ошибка простаивающего соединения с Postgres (пул восстановится сам):", err.message);
  });
  return pool;
}
