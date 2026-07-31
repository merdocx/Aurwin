import type { CreatureDto, Phase, ServerMessage, WorldEventDto, ZoneDto } from "./types";

interface CreatureFrame {
  dto: CreatureDto;
  /** Позиция на МОМЕНТ предыдущего снимка — точка, ОТКУДА интерполируем. */
  prevX: number;
  prevY: number;
  /** Позиция на МОМЕНТ последнего снимка — точка, К которой интерполируем. */
  targetX: number;
  targetY: number;
  /** Время (performance.now()), когда пришёл targetX/targetY. */
  updatedAt: number;
}

export interface RenderCreature extends CreatureDto {
  renderX: number;
  renderY: number;
}

export interface TimedEvent extends WorldEventDto {
  receivedAt: number;
}

/** Существо остаётся видимым (но не интерполируется дальше) EVENT_GRACE_MS после исчезновения из delta — соответствует «мягкой» подаче смерти (6.1: без резких исчезновений посреди кадра). */
const EVENT_DISPLAY_MS = 2500;

/**
 * Держит последнее известное состояние мира ВНЕ React (обновляется на
 * каждое WS-сообщение, читается PixiJS-тикером каждый кадр). Разделение
 * нужно, чтобы 60 FPS рендера не означали 60 React-рендеров/сек — React
 * узнаёт только о редких изменениях (смена тика/фазы), а интерполяция
 * позиций живёт в этом сторе (А.6: "клиент интерполирует позиции между
 * дельтами (lerp за длительность тика)").
 */
export class WorldStore {
  zones: ZoneDto[] = [];
  tickSeconds = 2;
  tick = 0;
  phase: Phase = "day";
  private creatures = new Map<string, CreatureFrame>();
  private events: TimedEvent[] = [];

  applySnapshot(msg: { tick: number; phase: Phase; tick_seconds: number; creatures: CreatureDto[]; zones: ZoneDto[] }): void {
    this.zones = msg.zones;
    this.tickSeconds = msg.tick_seconds;
    this.tick = msg.tick;
    this.phase = msg.phase;
    const now = performance.now();
    this.creatures.clear();
    for (const dto of msg.creatures) {
      this.creatures.set(dto.id, { dto, prevX: dto.x, prevY: dto.y, targetX: dto.x, targetY: dto.y, updatedAt: now });
    }
  }

  applyDelta(msg: { tick: number; phase: Phase; creatures: CreatureDto[]; events: WorldEventDto[] }): void {
    this.tick = msg.tick;
    this.phase = msg.phase;
    const now = performance.now();
    const seen = new Set<string>();
    for (const dto of msg.creatures) {
      seen.add(dto.id);
      const existing = this.creatures.get(dto.id);
      if (existing) {
        existing.prevX = existing.targetX;
        existing.prevY = existing.targetY;
        existing.targetX = dto.x;
        existing.targetY = dto.y;
        existing.updatedAt = now;
        existing.dto = dto;
      } else {
        // Новое (родилось/вошло в видимую область) — без наезда с (0,0).
        this.creatures.set(dto.id, { dto, prevX: dto.x, prevY: dto.y, targetX: dto.x, targetY: dto.y, updatedAt: now });
      }
    }
    // Существа, отсутствующие в этой дельте (умерли или покинули видимую
    // область), убираются сразу — драматизм смерти несёт world_event
    // (death/hunt_success), а не задержка исчезновения спрайта.
    for (const id of [...this.creatures.keys()]) {
      if (!seen.has(id)) this.creatures.delete(id);
    }
    for (const e of msg.events) this.events.push({ ...e, receivedAt: now });
    const cutoff = now - EVENT_DISPLAY_MS;
    this.events = this.events.filter((e) => e.receivedAt >= cutoff);
  }

  handleMessage(msg: ServerMessage): void {
    if (msg.type === "snapshot") this.applySnapshot(msg);
    else if (msg.type === "delta") this.applyDelta(msg);
  }

  /** lerp за длительность тика (А.6) — t=0 на прошлой дельте, t=1 когда должна была прийти следующая. */
  getRenderState(now: number): RenderCreature[] {
    const durationMs = this.tickSeconds * 1000;
    const out: RenderCreature[] = [];
    for (const frame of this.creatures.values()) {
      const t = durationMs > 0 ? Math.min(1, (now - frame.updatedAt) / durationMs) : 1;
      out.push({
        ...frame.dto,
        renderX: frame.prevX + (frame.targetX - frame.prevX) * t,
        renderY: frame.prevY + (frame.targetY - frame.prevY) * t,
      });
    }
    return out;
  }

  getActiveEvents(now: number): TimedEvent[] {
    const cutoff = now - EVENT_DISPLAY_MS;
    return this.events.filter((e) => e.receivedAt >= cutoff);
  }

  creaturePosition(id: string): { x: number; y: number } | undefined {
    const frame = this.creatures.get(id);
    return frame ? { x: frame.targetX, y: frame.targetY } : undefined;
  }
}
