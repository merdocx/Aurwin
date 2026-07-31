import type { IncomingMessage } from "node:http";

/**
 * IP клиента для лимитеров (А.6). Без CDN/reverse-proxy перед api-gateway
 * (7.5 — "предложение", не развёрнуто в MVP-compose) единственный
 * достоверный источник — TCP-сокет, X-Forwarded-For здесь не доверенный
 * заголовок и намеренно не используется (иначе лимит тривиально обходится).
 */
export function clientIp(req: IncomingMessage): string {
  const addr = req.socket.remoteAddress ?? "unknown";
  return addr.startsWith("::ffff:") ? addr.slice(7) : addr;
}
