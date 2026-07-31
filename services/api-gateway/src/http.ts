import type { ServerResponse } from "node:http";

/**
 * Публичный read-only API без авторизации (А.6, 7.1) — фронтенд обращается
 * с другого origin (dev-сервер Vite :5173 -> api-gateway :3000), поэтому
 * ответы открыты для любого источника. Простые GET-запросы без кастомных
 * заголовков не требуют preflight (OPTIONS), поэтому достаточно заголовка
 * на самом ответе.
 */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}
