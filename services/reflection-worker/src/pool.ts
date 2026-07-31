import { Pool } from "pg";

/**
 * Пул подключений к Postgres — строка подключения только из окружения
 * (CLAUDE.md, «Незыблемые правила», п.1). Продублировано из
 * services/sim-engine/src/persistence/pool.ts по тому же принципу
 * независимости Docker-контекстов сервисов (см. ops/DEVIATIONS.md, фаза 6).
 */
export function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  const pool = connectionString ? new Pool({ connectionString }) : new Pool();
  // Без слушателя "error" разрыв простаивающего соединения (рестарт/пересоздание
  // контейнера postgres) — необработанное событие, валящее весь процесс
  // (см. тот же фикс и обоснование в services/sim-engine/src/persistence/pool.ts,
  // обнаружено живым прогоном в фазе 7). Ряды `reflections` остаются 'queued'
  // (7.3, деградация) — пул сам переподключится на следующем проходе очереди.
  pool.on("error", (err) => {
    console.error("[reflection-worker] ошибка простаивающего соединения с Postgres (пул восстановится сам):", err.message);
  });
  return pool;
}
