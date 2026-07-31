// api-gateway — WebSocket-поток состояния + REST для карточек (ТЗ А.1, 7.1).
// Фаза 5 «Наблюдение»: реальные REST/WS-эндпоинты (А.6), только чтение БД —
// этот процесс никогда не пишет игровое состояние (единственный писатель —
// sim-engine, А.1). narrative наружу не отдаётся ни одним эндпоинтом (6.1) —
// см. src/queries.ts, где ни один SELECT его не выбирает.

import { createPool } from "./pool.js";
import { createGatewayServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 3000);

const pool = createPool();
const server = createGatewayServer(pool);

server.listen(PORT, () => {
  console.log(`[api-gateway] слушает порт ${PORT} (REST /api/*, WS /ws)`);
});

process.on("SIGTERM", () => {
  console.log("[api-gateway] получен SIGTERM, завершение");
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
});
