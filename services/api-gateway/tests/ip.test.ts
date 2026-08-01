import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { clientIp } from "../src/ip.js";

function fakeReq(remoteAddress: string, headers: Record<string, string> = {}): IncomingMessage {
  return {
    socket: { remoteAddress },
    headers,
  } as unknown as IncomingMessage;
}

describe("clientIp", () => {
  it("без прокси берёт socket.remoteAddress и игнорирует X-Forwarded-For", () => {
    const req = fakeReq("203.0.113.10", { "x-forwarded-for": "198.51.100.1" });
    expect(clientIp(req)).toBe("203.0.113.10");
  });

  it("от docker/Caddy peer доверяет X-Forwarded-For (левый IP)", () => {
    const req = fakeReq("172.18.0.10", { "x-forwarded-for": "198.51.100.7, 172.18.0.10" });
    expect(clientIp(req)).toBe("198.51.100.7");
  });

  it("от docker peer без XFF падает на X-Real-IP", () => {
    const req = fakeReq("172.18.0.10", { "x-real-ip": "198.51.100.9" });
    expect(clientIp(req)).toBe("198.51.100.9");
  });

  it("нормализует IPv4-mapped IPv6", () => {
    const req = fakeReq("::ffff:172.18.0.5", { "x-forwarded-for": "::ffff:203.0.113.55" });
    expect(clientIp(req)).toBe("203.0.113.55");
  });
});
