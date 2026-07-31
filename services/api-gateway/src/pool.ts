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
  const pool = connectionString ? new Pool({ connectionString }) : new Pool();
  // Без слушателя "error" разрыв простаивающего соединения (рестарт/пересоздание
  // контейнера postgres) — необработанное событие, валящее весь процесс
  // (см. тот же фикс и обоснование в services/sim-engine/src/persistence/pool.ts,
  // обнаружено живым прогоном в фазе 7) — наблюдатели потеряли бы WebSocket
  // ровно в момент, когда обслуживание Postgres и так временно недоступно.
  pool.on("error", (err) => {
    console.error("[api-gateway] ошибка простаивающего соединения с Postgres (пул восстановится сам):", err.message);
  });
  return pool;
}
