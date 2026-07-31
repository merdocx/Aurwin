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
  const pool = connectionString ? new Pool({ connectionString }) : new Pool();
  // `pg` эмитит "error" на пуле, когда ПРОСТАИВАЮЩЕЕ (idle) соединение рвётся
  // сетью/рестартом Postgres (например, "terminating connection due to
  // administrator command" при `docker compose restart postgres`/пересоздании
  // контейнера) — без слушателя это необработанное событие валит весь процесс
  // (обнаружено живым прогоном в фазе 7: рестарт postgres убивал sim-engine).
  // Это ровно тот же принцип, что и "симуляция никогда не блокируется" (7.3,
  // CLAUDE.md п.5), применённый к транзиентным сбоям Postgres, а не LLM: пул
  // сам открывает новое соединение при следующем запросе, тик-цикл просто
  // залогирует ошибку конкретного тика (см. try/catch в index.ts::loop) и
  // продолжит следующим тиком.
  pool.on("error", (err) => {
    console.error("[sim-engine] ошибка простаивающего соединения с Postgres (пул восстановится сам):", err.message);
  });
  return pool;
}
