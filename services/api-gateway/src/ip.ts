import type { IncomingMessage } from "node:http";

/**
 * IP клиента для лимитеров (А.6).
 *
 * Перед api-gateway стоит Caddy (ops/caddy/Caddyfile): TCP-сокет всегда
 * показывает адрес контейнера-прокси во внутренней docker-сети, а не
 * реального наблюдателя. Без разбора X-Forwarded-For лимит
 * `ws_max_connections_per_ip: 3` становится ОБЩИМ на весь сайт — отсюда
 * ложный отказ «мир сейчас популярен» уже на 4-м вкладке/реконнекте.
 *
 * X-Forwarded-For доверяем ТОЛЬКО если непосредственный peer — частная
 * сеть (docker/Caddy). Иначе (прямой доступ в тестах / без прокси) берём
 * socket.remoteAddress и игнорируем клиентский заголовок (иначе лимит
 * обходится подстановкой чужого IP).
 */
function isPrivateOrLocal(ip: string): boolean {
  if (ip === "unknown" || ip === "127.0.0.1" || ip === "::1") return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (ip.startsWith("172.")) {
    const second = Number(ip.split(".")[1] ?? NaN);
    return second >= 16 && second <= 31;
  }
  // IPv6 ULA / link-local
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80:")) return true;
  return false;
}

function normalizeIp(addr: string): string {
  return addr.startsWith("::ffff:") ? addr.slice(7) : addr;
}

/** Левый (исходный клиент) IP из X-Forwarded-For / X-Real-IP. */
function forwardedClientIp(req: IncomingMessage): string | undefined {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) {
    // Caddy дописывает: "client, proxy1, ..." — берём первый.
    const first = xff.split(",")[0]?.trim();
    if (first) return normalizeIp(first);
  }
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real.trim()) return normalizeIp(real.trim());
  return undefined;
}

export function clientIp(req: IncomingMessage): string {
  const peer = normalizeIp(req.socket.remoteAddress ?? "unknown");
  if (isPrivateOrLocal(peer)) {
    const forwarded = forwardedClientIp(req);
    if (forwarded) return forwarded;
  }
  return peer;
}
