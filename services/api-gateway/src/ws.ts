import type { Server as HttpServer, IncomingMessage } from "node:http";
import { Client, type Pool } from "pg";
import { WebSocketServer, WebSocket } from "ws";
import { getConstants, type GatewayConstants } from "./config.js";
import { zoneLayout } from "./zones.js";
import { ageStageFor, ageWeeksAt } from "./age.js";
import { getAliveCreaturesLight, getWorldClock, getWorldEventsSinceTick, type LiveCreatureRow } from "./queries.js";
import { WsConnectionLimiter, WsMessageRateLimiter } from "./rateLimit.js";
import { clientIp } from "./ip.js";

/**
 * WS-поток состояния (А.6): snapshot при подключении, delta каждые 1-2 сек
 * со всеми живыми существами (~50). Viewport принимается для будущей оптимизации,
 * но не фильтрует delta — иначе клиент «замораживает» существ вне экрана.
 * `narrative` здесь в принципе недостижим — все данные через queries.ts.
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
  released: boolean;
  msgLimiter: WsMessageRateLimiter;
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
    activity: row.activity ?? "idle",
    age_band: ageStageFor(row.species, ageWeeks),
  };
}

/** Компактный отпечаток для sparse delta (без age_band — он редко нужен клиенту между снапшотами). */
function creatureFingerprint(row: LiveCreatureRow): string {
  const e = row.emotion ?? { valence: 0, arousal: 0 };
  return [
    row.pos_x.toFixed(1),
    row.pos_y.toFixed(1),
    row.zone ?? "",
    row.is_asleep ? "1" : "0",
    row.activity ?? "",
    Number(e.valence).toFixed(2),
    Number(e.arousal).toFixed(2),
    row.name,
  ].join("|");
}

class GatewayHub {
  private readonly clients = new Set<ClientState>();
  private readonly limiter: WsConnectionLimiter;
  private readonly constants: GatewayConstants;
  /** Последний отправленный clock.tick (для dedup creature delta). */
  private lastClockTick = 0;
  /** Курсор world_events: (tick, id), чтобы truncate LIMIT не терял хвост. */
  private lastEventTick = 0;
  private lastEventId = "00000000-0000-0000-0000-000000000000";
  private idleTimer?: NodeJS.Timeout;
  private broadcastTimer?: NodeJS.Timeout;
  private listenClient?: Client;
  /** Последние отпечатки существ — sparse delta шлёт только изменившихся. */
  private lastFingerprints = new Map<string, string>();
  private sparseTickCounter = 0;
  private broadcastInFlight = false;
  /** Пока in-flight пришёл ещё один NOTIFY/interval — повторить после. */
  private broadcastAgain = false;

  constructor(
    private readonly pool: Pool,
    private readonly wss: WebSocketServer,
  ) {
    this.constants = getConstants();
    this.limiter = new WsConnectionLimiter(this.constants.api.ws_max_connections_per_ip, this.constants.api.ws_max_total_connections);
  }

  attach(httpServer: HttpServer): void {
    httpServer.on("upgrade", (req, socket, head) => {
      if (req.url !== "/ws" && !req.url?.startsWith("/ws?")) {
        socket.destroy();
        return;
      }
      const ip = clientIp(req);
      // Если с IP уже max соединений — вытесняем самое старое (вкладка/зомби),
      // а не отказываем новому наблюдателю. Общий потолок сервера — жёсткий.
      if (this.limiter.isTotalFull()) {
        console.warn(`[api-gateway] WS отказ (сервер полон) ip=${ip} ${this.limiter.debugState()}`);
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          ws.send(JSON.stringify({ type: "error", message: "мир сейчас популярен, попробуйте позже" }));
          ws.close(1013, "over capacity");
        });
        return;
      }
      if (this.limiter.wouldExceedPerIp(ip)) {
        this.evictOldestForIp(ip);
      }
      if (!this.limiter.tryAcquire(ip)) {
        console.warn(`[api-gateway] WS отказ (ёмкость) ip=${ip} ${this.limiter.debugState()}`);
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          ws.send(JSON.stringify({ type: "error", message: "мир сейчас популярен, попробуйте позже" }));
          ws.close(1013, "over capacity");
        });
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.onConnection(ws, ip);
      });
    });

    this.idleTimer = setInterval(() => this.disconnectIdle(), 30_000).unref();
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
      // Ping детектит полуоткрытые TCP; без ответа ws-библиотека закроет сокет.
      if (state.ws.readyState === WebSocket.OPEN) {
        try {
          state.ws.ping();
        } catch {
          /* ignore */
        }
      }
      if (now - state.lastActivity > idleMs) state.ws.close(1000, "idle timeout");
    }
  }

  /** Закрывает самое давно неактивное соединение этого IP и сразу освобождает слот. */
  private evictOldestForIp(ip: string): void {
    let oldest: ClientState | undefined;
    for (const state of this.clients) {
      if (state.ip !== ip) continue;
      if (!oldest || state.lastActivity < oldest.lastActivity) oldest = state;
    }
    if (!oldest) return;
    console.warn(`[api-gateway] WS вытеснение старого соединения ip=${ip}`);
    // Слот освобождаем синхронно — иначе tryAcquire сразу после гоняет с close-колбэком.
    this.releaseClient(oldest);
    try {
      oldest.ws.close(1000, "replaced by newer observer");
    } catch {
      /* already released */
    }
  }

  private releaseClient(state: ClientState): void {
    if (state.released) return;
    state.released = true;
    this.clients.delete(state);
    this.limiter.release(state.ip);
  }

  private onConnection(ws: WebSocket, ip: string): void {
    const state: ClientState = {
      ws,
      ip,
      lastActivity: Date.now(),
      released: false,
      msgLimiter: new WsMessageRateLimiter(WS_MAX_MESSAGES_PER_SECOND),
    };
    this.clients.add(state);

    ws.on("pong", () => {
      state.lastActivity = Date.now();
    });

    ws.on("message", (data) => {
      if (!state.msgLimiter.tryAcquire()) return;
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

    ws.on("close", () => this.releaseClient(state));
    ws.on("error", () => this.releaseClient(state));

    void this.sendSnapshot(state);
  }

  private async sendSnapshot(state: ClientState): Promise<void> {
    try {
      const [clock, creatures] = await Promise.all([getWorldClock(this.pool), getAliveCreaturesLight(this.pool)]);
      this.lastClockTick = Math.max(this.lastClockTick, clock.tick);
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
            inner_day_real_hours: this.constants.time.inner_day_real_hours,
            creatures: dto,
            zones: zoneLayout(),
            fish_density: clock.fishDensity,
          }),
        );
      }
    } catch (err) {
      console.error("[api-gateway] ошибка snapshot:", err);
    }
  }

  /** Общий для ВСЕХ клиентов запрос к БД раз в тик; один payload на всех клиентов. */
  async broadcastTick(): Promise<void> {
    if (this.clients.size === 0) return;
    if (this.broadcastInFlight) {
      this.broadcastAgain = true;
      return;
    }
    this.broadcastInFlight = true;
    try {
      do {
        this.broadcastAgain = false;
        await this.broadcastOnce();
      } while (this.broadcastAgain && this.clients.size > 0);
    } finally {
      this.broadcastInFlight = false;
    }
  }

  private async broadcastOnce(): Promise<void> {
    const EVENT_LIMIT = 500;
    try {
      const [clock, creatures, events] = await Promise.all([
        getWorldClock(this.pool),
        getAliveCreaturesLight(this.pool),
        getWorldEventsSinceTick(this.pool, this.lastEventTick, { sinceId: this.lastEventId, limit: EVENT_LIMIT }),
      ]);
      // Dedup: NOTIFY + interval могут совпасть на одном tick без новых events.
      if (clock.tick === this.lastClockTick && events.length === 0) return;

      if (events.length > 0) {
        const last = events[events.length - 1];
        this.lastEventTick = Number(last.tick);
        this.lastEventId = last.id;
      }
      if (events.length >= EVENT_LIMIT) {
        this.broadcastAgain = true;
      }
      this.lastClockTick = Math.max(this.lastClockTick, clock.tick);

      const eventDtos = events.map((e) => ({
        id: e.id,
        tick: Number(e.tick),
        type: e.type,
        actor_id: e.actor_id,
        target_id: e.target_id,
        zone: e.zone,
        payload: e.payload,
      }));

      // Полный roster каждые 15 тиков + при смене набора id; иначе только изменившиеся.
      this.sparseTickCounter += 1;
      const forceFull = this.sparseTickCounter >= 15 || this.lastFingerprints.size !== creatures.length;
      if (forceFull) this.sparseTickCounter = 0;

      const nextFingerprints = new Map<string, string>();
      const changed: LiveCreatureRow[] = [];
      for (const c of creatures) {
        const fp = creatureFingerprint(c);
        nextFingerprints.set(c.id, fp);
        if (forceFull || this.lastFingerprints.get(c.id) !== fp) changed.push(c);
      }
      this.lastFingerprints = nextFingerprints;

      const creatureDtos = changed.map((c) => creatureDto(c, clock.tick, this.constants.time.visual_tick_seconds));
      const payload = JSON.stringify({
        type: "delta",
        tick: clock.tick,
        phase: clock.phase,
        creatures: creatureDtos,
        events: eventDtos,
        fish_density: clock.fishDensity,
        full_roster: forceFull,
      });

      for (const state of this.clients) {
        if (state.ws.readyState !== WebSocket.OPEN) continue;
        state.ws.send(payload);
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

const WS_MAX_PAYLOAD_BYTES = 64 * 1024;
/** Лимит входящих WS-сообщений от клиента (viewport spam), см. ops/DEVIATIONS.md P2. */
const WS_MAX_MESSAGES_PER_SECOND = 20;

export function attachWebSocketServer(httpServer: HttpServer, pool: Pool): GatewayHub {
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD_BYTES });
  const hub = new GatewayHub(pool, wss);
  hub.attach(httpServer);
  void startListener(process.env.DATABASE_URL, () => void hub.broadcastTick(), hub);
  return hub;
}
