import type { Server as HttpServer, IncomingMessage } from "node:http";
import { Client, type Pool } from "pg";
import { WebSocketServer, WebSocket } from "ws";
import { getConstants, type GatewayConstants } from "./config.js";
import { zoneLayout } from "./zones.js";
import { ageStageFor, ageWeeksAt } from "./age.js";
import { getAliveCreaturesLight, getWorldClock, getWorldEventsSinceTick, type LiveCreatureRow } from "./queries.js";
import { WsConnectionLimiter } from "./rateLimit.js";
import { clientIp } from "./ip.js";

/**
 * WS-поток состояния (А.6): snapshot при подключении, delta каждые 1-2 сек
 * ПО ВИДИМОЙ ОБЛАСТИ клиента. `narrative` здесь в принципе недостижим —
 * все данные приходят через queries.ts, который его никогда не выбирает.
 */

interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

function isViewportMessage(msg: unknown): msg is { type: "viewport" } & Viewport {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    m.type === "viewport" &&
    typeof m.x === "number" &&
    typeof m.y === "number" &&
    typeof m.width === "number" &&
    typeof m.height === "number"
  );
}

interface ClientState {
  ws: WebSocket;
  ip: string;
  viewport?: Viewport;
  lastActivity: number;
}

function inViewport(row: LiveCreatureRow, vp: Viewport | undefined): boolean {
  if (!vp) return true;
  return row.pos_x >= vp.x && row.pos_x <= vp.x + vp.width && row.pos_y >= vp.y && row.pos_y <= vp.y + vp.height;
}

function creatureDto(row: LiveCreatureRow, currentTick: number, visualTickSeconds: number) {
  const ageWeeks = ageWeeksAt(Number(row.born_at_tick), currentTick, visualTickSeconds);
  return {
    id: row.id,
    species: row.species,
    name: row.name,
    x: row.pos_x,
    y: row.pos_y,
    zone: row.zone,
    emotion: row.emotion,
    is_asleep: row.is_asleep,
    age_band: ageStageFor(row.species, ageWeeks),
  };
}

class GatewayHub {
  private readonly clients = new Set<ClientState>();
  private readonly limiter: WsConnectionLimiter;
  private readonly constants: GatewayConstants;
  private lastBroadcastTick = 0;
  private idleTimer?: NodeJS.Timeout;
  private broadcastTimer?: NodeJS.Timeout;
  private listenClient?: Client;

  constructor(
    private readonly pool: Pool,
    private readonly wss: WebSocketServer,
  ) {
    this.constants = getConstants();
    this.limiter = new WsConnectionLimiter(this.constants.api.ws_max_connections_per_ip, this.constants.api.ws_max_total_connections);
  }

  attach(httpServer: HttpServer): void {
    httpServer.on("upgrade", (req, socket, head) => {
      if (req.url !== "/ws") {
        socket.destroy();
        return;
      }
      const ip = clientIp(req);
      if (!this.limiter.tryAcquire(ip)) {
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          // Graceful-отказ вместо падения api-gateway (А.6).
          ws.send(JSON.stringify({ type: "error", message: "мир сейчас популярен, попробуйте позже" }));
          ws.close(1013, "over capacity");
        });
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.onConnection(ws, ip);
      });
    });

    this.idleTimer = setInterval(() => this.disconnectIdle(), 60_000).unref();
    this.broadcastTimer = setInterval(() => void this.broadcastTick(), this.constants.time.visual_tick_seconds * 1000).unref();
    httpServer.on("close", () => this.stop());
  }

  setListenClient(client: Client): void {
    this.listenClient = client;
  }

  /** Освобождает таймеры/соединение LISTEN — нужно тестам, поднимающим и закрывающим сервер многократно в одном процессе. */
  stop(): void {
    if (this.idleTimer) clearInterval(this.idleTimer);
    if (this.broadcastTimer) clearInterval(this.broadcastTimer);
    void this.listenClient?.end();
    for (const state of this.clients) state.ws.close(1001, "server shutting down");
  }

  private disconnectIdle(): void {
    const idleMs = this.constants.api.ws_idle_timeout_minutes * 60_000;
    const now = Date.now();
    for (const state of this.clients) {
      if (now - state.lastActivity > idleMs) state.ws.close(1000, "idle timeout");
    }
  }

  private onConnection(ws: WebSocket, ip: string): void {
    const state: ClientState = { ws, ip, lastActivity: Date.now() };
    this.clients.add(state);

    ws.on("message", (data) => {
      state.lastActivity = Date.now();
      try {
        const msg = JSON.parse(data.toString());
        if (isViewportMessage(msg)) {
          state.viewport = { x: msg.x, y: msg.y, width: msg.width, height: msg.height };
        }
        // Никаких других типов сообщений не обрабатывается: наблюдателю
        // доступна только навигация/приближение, никаких действий (6.1).
      } catch {
        // Некорректный JSON молча игнорируется — не повод рвать соединение.
      }
    });

    ws.on("close", () => {
      this.clients.delete(state);
      this.limiter.release(ip);
    });

    ws.on("error", () => {
      this.clients.delete(state);
      this.limiter.release(ip);
    });

    void this.sendSnapshot(state);
  }

  private async sendSnapshot(state: ClientState): Promise<void> {
    try {
      const [clock, creatures] = await Promise.all([getWorldClock(this.pool), getAliveCreaturesLight(this.pool)]);
      this.lastBroadcastTick = Math.max(this.lastBroadcastTick, clock.tick);
      const dto = creatures.map((c) => creatureDto(c, clock.tick, this.constants.time.visual_tick_seconds));
      if (state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(
          JSON.stringify({
            type: "snapshot",
            tick: clock.tick,
            phase: clock.phase,
            // Клиент интерполирует движение между дельтами (А.6) — период
            // берётся с сервера, а не дублируется как хардкод во фронтенде
            // (CLAUDE.md, п.3: числа симуляции только из constants.yaml).
            tick_seconds: this.constants.time.visual_tick_seconds,
            creatures: dto,
            zones: zoneLayout(),
          }),
        );
      }
    } catch (err) {
      console.error("[api-gateway] ошибка snapshot:", err);
    }
  }

  /** Общий для ВСЕХ клиентов запрос к БД раз в тик — фильтрация по видимой области происходит уже в памяти, не в БД (О(clients) не растёт с числом запросов). */
  async broadcastTick(): Promise<void> {
    if (this.clients.size === 0) return;
    try {
      const [clock, creatures, events] = await Promise.all([
        getWorldClock(this.pool),
        getAliveCreaturesLight(this.pool),
        getWorldEventsSinceTick(this.pool, this.lastBroadcastTick),
      ]);
      this.lastBroadcastTick = clock.tick;

      const eventDtos = events.map((e) => ({
        id: e.id,
        tick: Number(e.tick),
        type: e.type,
        actor_id: e.actor_id,
        target_id: e.target_id,
        zone: e.zone,
        payload: e.payload,
      }));

      for (const state of this.clients) {
        if (state.ws.readyState !== WebSocket.OPEN) continue;
        const visible = creatures.filter((c) => inViewport(c, state.viewport));
        const dto = visible.map((c) => creatureDto(c, clock.tick, this.constants.time.visual_tick_seconds));
        state.ws.send(JSON.stringify({ type: "delta", tick: clock.tick, phase: clock.phase, creatures: dto, events: eventDtos }));
      }
    } catch (err) {
      console.error("[api-gateway] ошибка broadcastTick:", err);
    }
  }
}

/** Отдельный клиент (не из пула) для LISTEN — уведомление лишь подстёгивает внеочередной broadcastTick, основной ритм держит интервал visual_tick_seconds (см. GatewayHub.attach). */
async function startListener(databaseUrl: string | undefined, onNotify: () => void, hub: GatewayHub): Promise<void> {
  const client = new Client(databaseUrl ? { connectionString: databaseUrl } : undefined);
  try {
    await client.connect();
    await client.query("LISTEN world_tick");
    hub.setListenClient(client);
    client.on("notification", () => onNotify());
    client.on("error", (err) => console.error("[api-gateway] LISTEN-соединение оборвалось:", err));
  } catch (err) {
    console.error("[api-gateway] не удалось подписаться на world_tick (используется только резервный интервал):", err);
  }
}

export function attachWebSocketServer(httpServer: HttpServer, pool: Pool): GatewayHub {
  const wss = new WebSocketServer({ noServer: true });
  const hub = new GatewayHub(pool, wss);
  hub.attach(httpServer);
  void startListener(process.env.DATABASE_URL, () => void hub.broadcastTick(), hub);
  return hub;
}
