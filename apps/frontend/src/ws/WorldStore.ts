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
  /** Множитель max step после недолёта (land-push / separation). */
  catchUpBoost: number;
  /** Display velocity (у.е./мс) — damp между тиками против щелчка. */
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
/** Макс. визуальный шаг за тик (у.е.) — penguin; orca / catch-up выше. */
const MAX_VISUAL_STEP = 28;
const MAX_VISUAL_STEP_ORCA = 52;
const FACING_SMOOTH = 0.14;
/** Не крутить facing при почти вертикальном/малом смещении. */
const FACING_DEADZONE = 0.05;
/** Blend lerp↔velocity extrapolation (0 = только lerp, 1 = только velocity). */
const VELOCITY_BLEND = 0.35;
const VELOCITY_DAMP = 0.92;
/** Квант emotion для meta-сравнения — меньше churn React. */
const EMOTION_Q = 0.05;

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function samplePos(frame: CreatureFrame, now: number, durationMs: number): { x: number; y: number; t: number } {
  const rawT = durationMs > 0 ? Math.min(1, (now - frame.updatedAt) / durationMs) : 1;
  const t = smoothstep(rawT);
  const lerpX = frame.prevX + (frame.targetX - frame.prevX) * t;
  const lerpY = frame.prevY + (frame.targetY - frame.prevY) * t;

  // Velocity damp: сглаживает границу тика (anti-snap).
  const dt = Math.max(0, Math.min(50, now - frame.lastSampleAt));
  if (dt > 0 && frame.lastSampleAt > 0) {
    frame.vx *= VELOCITY_DAMP;
    frame.vy *= VELOCITY_DAMP;
    const ex = frame.lastSampleX + frame.vx * dt;
    const ey = frame.lastSampleY + frame.vy * dt;
    const x = lerpX * (1 - VELOCITY_BLEND) + ex * VELOCITY_BLEND;
    const y = lerpY * (1 - VELOCITY_BLEND) + ey * VELOCITY_BLEND;
    // Подтягиваем velocity к направлению lerp.
    const invDt = 1 / Math.max(1, dt);
    frame.vx = frame.vx * 0.7 + (x - frame.lastSampleX) * invDt * 0.3;
    frame.vy = frame.vy * 0.7 + (y - frame.lastSampleY) * invDt * 0.3;
    frame.lastSampleX = x;
    frame.lastSampleY = y;
    frame.lastSampleAt = now;
    return { x, y, t };
  }

  frame.lastSampleX = lerpX;
  frame.lastSampleY = lerpY;
  frame.lastSampleAt = now;
  return { x: lerpX, y: lerpY, t };
}

/**
 * Держит состояние мира ВНЕ React. Позиции — RAF ~60 FPS с ease-lerp + velocity damp;
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
  private creatures = new Map<string, CreatureFrame>();
  private events: TimedEvent[] = [];
  private zoneTypeByName = new Map<string, "ice" | "water">();
  private dirtyMetaIds = new Set<string>();

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
      catchUpBoost: 1,
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
    const durationMs = this.tickSeconds * 1000;
    let metaChanged = false;

    for (const dto of msg.creatures) {
      const existing = this.creatures.get(dto.id);
      if (existing) {
        const prevDto = existing.dto;
        const wasMoving = Math.hypot(existing.targetX - existing.prevX, existing.targetY - existing.prevY) > MOVE_EPS;
        // Rebase от текущей отрисованной позиции — без рывка при новом delta.
        const cur = samplePos(existing, now, durationMs);
        let dx = dto.x - cur.x;
        let dy = dto.y - cur.y;
        const dist = Math.hypot(dx, dy);
        const baseMax = dto.species === "orca" ? MAX_VISUAL_STEP_ORCA : MAX_VISUAL_STEP;
        const maxStep = baseMax * existing.catchUpBoost;
        if (dist > maxStep) {
          const s = maxStep / dist;
          dx *= s;
          dy *= s;
          existing.catchUpBoost = Math.min(2.5, existing.catchUpBoost * 1.35);
        } else {
          existing.catchUpBoost = 1;
        }
        existing.prevX = cur.x;
        existing.prevY = cur.y;
        existing.targetX = cur.x + dx;
        existing.targetY = cur.y + dy;
        existing.updatedAt = now;
        // Задать display velocity к новому target на длительность тика.
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
  }

  handleMessage(msg: ServerMessage): void {
    if (msg.type === "snapshot") this.applySnapshot(msg);
    else if (msg.type === "delta") this.applyDelta(msg);
  }

  getPositions(now: number): RenderPosition[] {
    const durationMs = this.tickSeconds * 1000;
    const out: RenderPosition[] = [];
    for (const frame of this.creatures.values()) {
      const { x, y } = samplePos(frame, now, durationMs);
      const dx = frame.targetX - frame.prevX;
      const dy = frame.targetY - frame.prevY;
      const mag = Math.hypot(dx, dy);
      if (mag > MOVE_EPS) {
        const desired = Math.atan2(dy, dx);
        // Deadzone: не флипать scaleX на почти вертикальном курсе.
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
      out.push({ id: frame.dto.id, x, y, facing: frame.facing });
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
