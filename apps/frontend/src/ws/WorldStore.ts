import type { CreatureActivity, CreatureDto, Phase, ServerMessage, WorldEventDto, ZoneDto } from "./types";

interface CreatureFrame {
  dto: CreatureDto;
  /** Точка, ОТКУДА интерполируем (= последняя отрисованная при rebase). */
  prevX: number;
  prevY: number;
  /** Точка, К которой интерполируем (sim). */
  targetX: number;
  targetY: number;
  updatedAt: number;
  /** Сглаженный угол взгляда (рад). */
  facing: number;
  facingInitialized: boolean;
  /** Display faceRight с гистерезисом (лёд / scaleX). */
  faceRight: boolean;
  /** Display velocity (у.е./мс) — coast после t>1. */
  vx: number;
  vy: number;
  lastSampleX: number;
  lastSampleY: number;
  lastSampleAt: number;
}

export interface RenderPosition {
  id: string;
  x: number;
  y: number;
  /** Сглаженный facing для scaleX / rotate. */
  facing: number;
  faceRight: boolean;
}

export interface CreatureMeta {
  id: string;
  name: string;
  species: CreatureDto["species"];
  zone: string;
  emotion: CreatureDto["emotion"];
  is_asleep: boolean;
  moving: boolean;
  activity?: CreatureActivity;
}

export interface TimedEvent extends WorldEventDto {
  receivedAt: number;
}

/** Сколько держать badge/pulse на карте. */
const EVENT_DISPLAY_MS = 2500;
/** Ring-buffer ленты событий наблюдателя (дольше badge). */
const EVENT_LOG_MS = 16000;
const MOVE_EPS = 0.5;
/** Только телепорты режем; cruise/separation (≤~40) проходят без лестницы. */
const TELEPORT_CLAMP = 100;
const FACING_SMOOTH = 0.18;
/** Не крутить facing при почти вертикальном/малом смещении. */
const FACING_DEADZONE = 0.05;
/** Гистерезис faceRight: не флипать, пока |cos| не уверен. */
const FACE_RIGHT_ENTER = 0.12;
const FACE_RIGHT_EXIT = -0.12;
/** EMA интервала между delta (мс). */
const DURATION_EMA_ALPHA = 0.25;
/** Квант emotion для meta-сравнения — меньше churn React. */
const EMOTION_Q = 0.05;

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * Линейный lerp на [0,1]; при t>1 — coast по vx/vy (без остановки на границе тика).
 */
function samplePos(frame: CreatureFrame, now: number, durationMs: number): { x: number; y: number; t: number } {
  const elapsed = now - frame.updatedAt;
  const rawT = durationMs > 0 ? elapsed / durationMs : 1;
  const dt = frame.lastSampleAt > 0 ? Math.max(0, Math.min(50, now - frame.lastSampleAt)) : 0;

  let x: number;
  let y: number;
  if (rawT <= 1) {
    const t = Math.max(0, rawT);
    x = frame.prevX + (frame.targetX - frame.prevX) * t;
    y = frame.prevY + (frame.targetY - frame.prevY) * t;
  } else {
    // Coast: продолжаем с последней скоростью, слегка притягиваясь к target.
    const coastDt = Math.min(elapsed - durationMs, 200);
    x = frame.targetX + frame.vx * coastDt;
    y = frame.targetY + frame.vy * coastDt;
    // Мягкий pull к target, чтобы не улететь далеко при джиттере сети.
    x = x * 0.92 + frame.targetX * 0.08;
    y = y * 0.92 + frame.targetY * 0.08;
  }

  if (dt > 0 && frame.lastSampleAt > 0) {
    const invDt = 1 / Math.max(1, dt);
    frame.vx = frame.vx * 0.65 + (x - frame.lastSampleX) * invDt * 0.35;
    frame.vy = frame.vy * 0.65 + (y - frame.lastSampleY) * invDt * 0.35;
  }

  frame.lastSampleX = x;
  frame.lastSampleY = y;
  frame.lastSampleAt = now;
  return { x, y, t: rawT };
}

function updateFaceRight(frame: CreatureFrame, facing: number): void {
  const cos = Math.cos(facing);
  if (!frame.facingInitialized) {
    frame.faceRight = cos >= 0;
    return;
  }
  if (frame.faceRight && cos < FACE_RIGHT_EXIT) frame.faceRight = false;
  else if (!frame.faceRight && cos > FACE_RIGHT_ENTER) frame.faceRight = true;
}

/**
 * Держит состояние мира ВНЕ React. Позиции — RAF ~60 FPS с linear lerp + coast;
 * meta только на смене activity/emotion/sleep.
 */
export class WorldStore {
  zones: ZoneDto[] = [];
  fishDensity: Record<string, number> = {};
  fishDensityRevision = 0;
  tickSeconds = 2;
  tick = 0;
  phase: Phase = "day";
  metaRevision = 0;
  /** Сглаженный интервал между delta (мс) для интерполяции. */
  private durationMsEma = 2000;
  private lastDeltaAt = 0;
  private creatures = new Map<string, CreatureFrame>();
  private events: TimedEvent[] = [];
  private zoneTypeByName = new Map<string, "ice" | "water">();
  private dirtyMetaIds = new Set<string>();

  /** Listeners for tick/phase (header) without remounting the map. */
  private clockListeners = new Set<() => void>();

  subscribeClock(fn: () => void): () => void {
    this.clockListeners.add(fn);
    return () => this.clockListeners.delete(fn);
  }

  private emitClock(): void {
    for (const fn of this.clockListeners) fn();
  }

  consumeDirtyMetaIds(): Set<string> {
    const out = this.dirtyMetaIds;
    this.dirtyMetaIds = new Set();
    return out;
  }

  getMeta(id: string): CreatureMeta | undefined {
    const frame = this.creatures.get(id);
    if (!frame) return undefined;
    const moving = Math.hypot(frame.targetX - frame.prevX, frame.targetY - frame.prevY) > MOVE_EPS;
    return {
      id: frame.dto.id,
      name: frame.dto.name,
      species: frame.dto.species,
      zone: frame.dto.zone,
      emotion: frame.dto.emotion,
      is_asleep: frame.dto.is_asleep,
      moving,
      activity: frame.dto.activity,
    };
  }

  zoneType(name: string): "ice" | "water" | undefined {
    return this.zoneTypeByName.get(name);
  }

  private interpDurationMs(): number {
    return Math.max(400, this.durationMsEma);
  }

  private makeFrame(dto: CreatureDto, now: number): CreatureFrame {
    return {
      dto,
      prevX: dto.x,
      prevY: dto.y,
      targetX: dto.x,
      targetY: dto.y,
      updatedAt: now,
      facing: 0,
      facingInitialized: false,
      faceRight: true,
      vx: 0,
      vy: 0,
      lastSampleX: dto.x,
      lastSampleY: dto.y,
      lastSampleAt: now,
    };
  }

  applySnapshot(msg: {
    tick: number;
    phase: Phase;
    tick_seconds: number;
    creatures: CreatureDto[];
    zones: ZoneDto[];
    fish_density: Record<string, number>;
  }): void {
    this.zones = msg.zones;
    this.zoneTypeByName = new Map(msg.zones.map((z) => [z.name, z.type]));
    this.fishDensity = msg.fish_density;
    this.fishDensityRevision += 1;
    this.tickSeconds = msg.tick_seconds;
    this.durationMsEma = msg.tick_seconds * 1000;
    this.lastDeltaAt = 0;
    this.tick = msg.tick;
    this.phase = msg.phase;
    const now = performance.now();
    this.creatures.clear();
    this.dirtyMetaIds.clear();
    for (const dto of msg.creatures) {
      this.creatures.set(dto.id, this.makeFrame(dto, now));
      this.dirtyMetaIds.add(dto.id);
    }
    this.metaRevision += 1;
    this.emitClock();
  }

  applyDelta(msg: {
    tick: number;
    phase: Phase;
    creatures: CreatureDto[];
    events: WorldEventDto[];
    fish_density?: Record<string, number>;
  }): void {
    this.tick = msg.tick;
    this.phase = msg.phase;
    if (msg.fish_density) {
      this.fishDensity = msg.fish_density;
      this.fishDensityRevision += 1;
    }
    const now = performance.now();
    if (this.lastDeltaAt > 0) {
      const measured = now - this.lastDeltaAt;
      this.durationMsEma = this.durationMsEma * (1 - DURATION_EMA_ALPHA) + measured * DURATION_EMA_ALPHA;
    } else {
      this.durationMsEma = this.tickSeconds * 1000;
    }
    this.lastDeltaAt = now;
    const durationMs = this.interpDurationMs();
    let metaChanged = false;

    const seen = new Set<string>();
    for (const dto of msg.creatures) {
      seen.add(dto.id);
      const existing = this.creatures.get(dto.id);
      if (existing) {
        const prevDto = existing.dto;
        const wasMoving = Math.hypot(existing.targetX - existing.prevX, existing.targetY - existing.prevY) > MOVE_EPS;
        const cur = samplePos(existing, now, durationMs);
        let dx = dto.x - cur.x;
        let dy = dto.y - cur.y;
        const dist = Math.hypot(dx, dy);
        // Clamp только телепорты; обычные скачки separation/land-push пропускаем.
        if (dist > TELEPORT_CLAMP) {
          const s = TELEPORT_CLAMP / dist;
          dx *= s;
          dy *= s;
        }
        existing.prevX = cur.x;
        existing.prevY = cur.y;
        existing.targetX = cur.x + dx;
        existing.targetY = cur.y + dy;
        existing.updatedAt = now;
        const invDur = 1 / Math.max(1, durationMs);
        existing.vx = dx * invDur;
        existing.vy = dy * invDur;
        existing.dto = dto;
        const nowMoving = Math.hypot(dx, dy) > MOVE_EPS;
        const emotionChanged =
          Math.abs(prevDto.emotion.valence - dto.emotion.valence) >= EMOTION_Q ||
          Math.abs(prevDto.emotion.arousal - dto.emotion.arousal) >= EMOTION_Q;
        if (
          wasMoving !== nowMoving ||
          prevDto.zone !== dto.zone ||
          prevDto.is_asleep !== dto.is_asleep ||
          prevDto.name !== dto.name ||
          prevDto.activity !== dto.activity ||
          emotionChanged
        ) {
          metaChanged = true;
          this.dirtyMetaIds.add(dto.id);
        }
      } else {
        this.creatures.set(dto.id, this.makeFrame(dto, now));
        metaChanged = true;
        this.dirtyMetaIds.add(dto.id);
      }
    }

    for (const e of msg.events) {
      this.events.push({ ...e, receivedAt: now });
      if (e.type === "death" && e.actor_id) {
        if (this.creatures.delete(e.actor_id)) {
          metaChanged = true;
          this.dirtyMetaIds.add(e.actor_id);
        }
      }
      if (e.type === "hunt_success" && e.target_id) {
        if (this.creatures.delete(e.target_id)) {
          metaChanged = true;
          this.dirtyMetaIds.add(e.target_id);
        }
      }
    }
    const cutoff = now - EVENT_LOG_MS;
    this.events = this.events.filter((e) => e.receivedAt >= cutoff);
    if (metaChanged) this.metaRevision += 1;
    this.emitClock();
    void seen;
  }

  handleMessage(msg: ServerMessage): void {
    if (msg.type === "snapshot") this.applySnapshot(msg);
    else if (msg.type === "delta") this.applyDelta(msg);
  }

  getPositions(now: number): RenderPosition[] {
    const durationMs = this.interpDurationMs();
    const out: RenderPosition[] = [];
    for (const frame of this.creatures.values()) {
      const { x, y } = samplePos(frame, now, durationMs);
      const dx = frame.targetX - frame.prevX;
      const dy = frame.targetY - frame.prevY;
      const mag = Math.hypot(dx, dy);
      if (mag > MOVE_EPS) {
        const desired = Math.atan2(dy, dx);
        const cos = Math.cos(desired);
        if (Math.abs(cos) >= FACING_DEADZONE || !frame.facingInitialized) {
          if (!frame.facingInitialized) {
            frame.facing = desired;
            frame.facingInitialized = true;
          } else {
            frame.facing = lerpAngle(frame.facing, desired, FACING_SMOOTH);
          }
        }
      }
      updateFaceRight(frame, frame.facing);
      out.push({ id: frame.dto.id, x, y, facing: frame.facing, faceRight: frame.faceRight });
    }
    return out;
  }

  listMeta(): CreatureMeta[] {
    const out: CreatureMeta[] = [];
    for (const frame of this.creatures.values()) {
      const moving = Math.hypot(frame.targetX - frame.prevX, frame.targetY - frame.prevY) > MOVE_EPS;
      out.push({
        id: frame.dto.id,
        name: frame.dto.name,
        species: frame.dto.species,
        zone: frame.dto.zone,
        emotion: frame.dto.emotion,
        is_asleep: frame.dto.is_asleep,
        moving,
        activity: frame.dto.activity,
      });
    }
    return out;
  }

  ids(): string[] {
    return [...this.creatures.keys()];
  }

  getActiveEvents(now: number): TimedEvent[] {
    const cutoff = now - EVENT_DISPLAY_MS;
    return this.events.filter((e) => e.receivedAt >= cutoff);
  }

  /** Недавние события для ленты (дольше badge, ~12–20 с). */
  getLogEvents(now: number): TimedEvent[] {
    const cutoff = now - EVENT_LOG_MS;
    return this.events.filter((e) => e.receivedAt >= cutoff);
  }

  creatureName(id: string): string | undefined {
    return this.creatures.get(id)?.dto.name;
  }
}
