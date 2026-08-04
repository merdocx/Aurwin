import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Pool } from "pg";
import { getConstants } from "./config.js";
import { RestRateLimiter } from "./rateLimit.js";
import { clientIp } from "./ip.js";
import { sendJson } from "./http.js";
import { handleCreatureCard, handleGenealogy, handleSocialGraph, handleWorldStats } from "./rest.js";
import { attachWebSocketServer } from "./ws.js";

const CREATURE_PATH_RE = /^\/api\/creatures\/([^/]+)$/;

async function route(req: IncomingMessage, res: ServerResponse, pool: Pool): Promise<void> {
  const url = new URL(req.url ?? "/", "http://internal");

  if (req.method !== "GET") {
    // Публичный API — только чтение (А.6): "без действий, доступных наблюдателю, кроме навигации".
    sendJson(res, 405, { error: "метод не поддерживается" });
    return;
  }

  if (url.pathname === "/api/world/stats") return handleWorldStats(res, pool);
  if (url.pathname === "/api/social-graph") return handleSocialGraph(res, pool);
  if (url.pathname === "/api/genealogy") return handleGenealogy(res, pool);
  const creatureMatch = url.pathname.match(CREATURE_PATH_RE);
  if (creatureMatch) return handleCreatureCard(res, pool, decodeURIComponent(creatureMatch[1]));

  sendJson(res, 404, { error: "не найдено" });
}

export function createGatewayServer(pool: Pool) {
  const constants = getConstants();
  const restLimiter = new RestRateLimiter(constants.api.rest_rate_limit_per_minute);
  const sweepTimer = setInterval(() => restLimiter.sweep(), 60_000);
  sweepTimer.unref();

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://internal");
    if (!url.pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: "не найдено" });
      return;
    }

    const ip = clientIp(req);
    if (!restLimiter.tryAcquire(ip)) {
      res.setHeader("retry-after", "60");
      sendJson(res, 429, { error: "слишком много запросов, попробуйте позже" });
      return;
    }

    route(req, res, pool).catch((err) => {
      console.error("[api-gateway] ошибка обработки запроса:", err);
      if (!res.headersSent) sendJson(res, 500, { error: "внутренняя ошибка" });
    });
  });

  attachWebSocketServer(server, pool);
  return server;
}
