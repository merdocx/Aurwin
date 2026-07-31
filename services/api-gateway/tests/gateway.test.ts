import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import WebSocket from "ws";
import { ensureMigratedUp, getTestPool, insertCreature } from "../../db/tests/helpers.js";
import { createGatewayServer } from "../src/server.js";
import { resetSocialGraphCache } from "../src/rest.js";

/**
 * Гейт фазы 5 (docs/AURWIN_TZ.md, задача фазы 5):
 *   - narrative отсутствует в ответах публичных эндпоинтов;
 *   - rate-limit срабатывает (REST 60/мин/IP, WS 3 соединения/IP — А.6).
 * Использует общий эфемерный Postgres (tests/setup/global-db-setup.ts), как
 * и services/db/tests/*.
 */

function startServer(pool: ReturnType<typeof getTestPool>): Promise<{ server: Server; port: number; baseUrl: string }> {
  const server = createGatewayServer(pool);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, port, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** Рекурсивно ищет ключ "narrative" (НЕ "narrative_facts") в произвольной JSON-структуре. */
function containsNarrativeKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsNarrativeKey);
  if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key === "narrative") return true;
      if (containsNarrativeKey(v)) return true;
    }
  }
  return false;
}

let activeServer: Server | undefined;
const activeSockets: WebSocket[] = [];

afterEach(async () => {
  for (const ws of activeSockets.splice(0)) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.terminate();
  }
  if (activeServer) {
    await closeServer(activeServer);
    activeServer = undefined;
  }
  resetSocialGraphCache();
});

describe("api-gateway: narrative никогда не отдаётся публично (6.1, А.6)", () => {
  beforeAll(async () => {
    await ensureMigratedUp();
  });

  it("GET /api/creatures/{id} содержит narrative_facts, но не narrative", async () => {
    const pool = getTestPool();
    const secret = "ПОЛНЫЙ ВНУТРЕННИЙ ДНЕВНИК — НЕ ДЛЯ НАБЛЮДАТЕЛЯ";
    const id = await insertCreature(pool, { species: "penguin", name: "Тестовый пингвин" });
    await pool.query(
      `UPDATE creatures SET narrative = $2, narrative_facts = $3, zone = 'main_ice', pos_x = 10, pos_y = 20 WHERE id = $1`,
      [id, secret, JSON.stringify(["вылупился на льду", "подружился с соседом"])],
    );

    const { server, baseUrl } = await startServer(pool);
    activeServer = server;

    const res = await fetch(`${baseUrl}/api/creatures/${id}`);
    expect(res.status).toBe(200);
    const rawText = await res.text();
    expect(rawText).not.toContain(secret);
    expect(rawText).not.toContain('"narrative"');

    const body = JSON.parse(rawText);
    expect(containsNarrativeKey(body)).toBe(false);
    expect(body.narrative_facts).toEqual(["вылупился на льду", "подружился с соседом"]);
    expect(body.name).toBe("Тестовый пингвин");
  });

  it("GET /api/social-graph не содержит narrative и не содержит aversions", async () => {
    const pool = getTestPool();
    const { server, baseUrl } = await startServer(pool);
    activeServer = server;

    const res = await fetch(`${baseUrl}/api/social-graph`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(containsNarrativeKey(body)).toBe(false);
    expect(body).not.toHaveProperty("aversions");
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);
  });

  it("GET /api/world/stats не содержит narrative", async () => {
    const pool = getTestPool();
    const { server, baseUrl } = await startServer(pool);
    activeServer = server;

    const res = await fetch(`${baseUrl}/api/world/stats`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(containsNarrativeKey(body)).toBe(false);
    expect(body).toHaveProperty("population");
    expect(body).toHaveProperty("generation");
  });

  it("несуществующий id -> 404, а не 500", async () => {
    const pool = getTestPool();
    const { server, baseUrl } = await startServer(pool);
    activeServer = server;

    const res = await fetch(`${baseUrl}/api/creatures/00000000-0000-0000-0000-000000000000`);
    expect(res.status).toBe(404);
  });
});

describe("api-gateway: rate limit (А.6)", () => {
  beforeAll(async () => {
    await ensureMigratedUp();
  });

  it("60 REST-запросов/мин с IP разрешены, 61-й получает 429", async () => {
    const pool = getTestPool();
    const { server, baseUrl } = await startServer(pool);
    activeServer = server;

    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) {
      const res = await fetch(`${baseUrl}/api/world/stats`);
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(statuses[60]).toBe(429);
  }, 20_000);

  it("не более 3 одновременных WS-соединений с одного IP — 4-е получает graceful-отказ", async () => {
    const pool = getTestPool();
    const { server, baseUrl } = await startServer(pool);
    activeServer = server;
    const wsUrl = baseUrl.replace("http://", "ws://") + "/ws";

    async function connect(): Promise<WebSocket> {
      const ws = new WebSocket(wsUrl);
      activeSockets.push(ws);
      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", reject);
      });
      return ws;
    }

    const first = await connect();
    const second = await connect();
    const third = await connect();
    expect(first.readyState).toBe(WebSocket.OPEN);
    expect(second.readyState).toBe(WebSocket.OPEN);
    expect(third.readyState).toBe(WebSocket.OPEN);

    const fourth = new WebSocket(wsUrl);
    activeSockets.push(fourth);
    const fourthClosedCode = await new Promise<number>((resolve, reject) => {
      fourth.once("close", (code) => resolve(code));
      fourth.once("error", () => {
        /* сервер может закрыть до 'open' в некоторых окружениях — фиксируем через close */
      });
      setTimeout(() => reject(new Error("4-е соединение не было закрыто вовремя")), 5000);
    });
    expect(fourthClosedCode).toBe(1013);
  }, 20_000);
});
