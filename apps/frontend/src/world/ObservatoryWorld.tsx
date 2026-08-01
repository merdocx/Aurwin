/**
 * Карта мира Observatory: статический SVG-слой + императивные позиции существ (RAF),
 * метаданные React обновляются только при смене emotion/sleep/zone/набора.
 */
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { CreatureMeta, TimedEvent, WorldStore } from "../ws/WorldStore";
import type { EmotionKind } from "../ds/EmotionIndicator";
import { PanZoom, type MapRect, type PanZoomHandle } from "./PanZoom";
import { WorldMapSvg } from "./WorldMapSvg";
import { Creature, Fish, type CreatureState } from "./CreatureSprites";
import { FISH, MAP_H, MAP_W, ZONE_LABELS, isLandMap, toMap, toSim } from "./continents";
import {
  BADGE_EVENT_TYPES,
  SIGNAL_PULSE_TONES,
  eventInfo,
  signalPulseKind,
} from "./eventLabels";
import { EventLog, buildLogEntries, type LogEntry } from "./EventLog";

interface Props {
  store: WorldStore;
  onSelectCreature: (id: string) => void;
  onViewportChange: (vp: { x: number; y: number; width: number; height: number }) => void;
  focusCreatureId?: string | null;
}

interface ViewCreature {
  id: string;
  name: string;
  species: "penguin" | "orca";
  emotion: EmotionKind;
  state: CreatureState;
  swimming: boolean;
  facing: number;
  faceRight: boolean;
}

interface ElCache {
  el: HTMLButtonElement;
  facingEl: HTMLElement | null;
  noseLed: boolean;
  noseX: number;
  noseY: number;
}

interface HighlightRing {
  x: number;
  y: number;
  nonce: number;
}

const LOD_SCALE_THRESHOLD = 0.7;
const VIEWPORT_PAD = 160;

function deriveEmotion(meta: CreatureMeta): EmotionKind {
  const v = Math.max(-1, Math.min(1, meta.emotion.valence));
  const a = Math.max(0, Math.min(1, meta.emotion.arousal));
  if (v < -0.35 && a > 0.45) return "afraid";
  if (v < -0.25) return "grieving";
  if (v > 0.2 && a > 0.45) return "playful";
  return "calm";
}

function activityToState(meta: CreatureMeta, onLand: boolean): { state: CreatureState; swimming: boolean } {
  const a = meta.activity;
  if (meta.species === "orca") {
    if (a === "sleep" || meta.is_asleep) return { state: "sleeping", swimming: true };
    if (a === "hunt") return { state: "hunting", swimming: true };
    if (a === "transit_in") return { state: "entering_water", swimming: true };
    if (a === "transit_out") return { state: "exiting_water", swimming: true };
    return { state: meta.moving ? "swimming" : "swimming", swimming: true };
  }
  // Пингвин: поза воды только когда точка не на isLandMap (страховка от sticky transit/forage на льду).
  if (a === "sleep" || meta.is_asleep) return { state: "sleeping", swimming: !onLand };
  if (a === "transit_in") {
    if (onLand) return { state: meta.moving ? "walking" : "idle", swimming: false };
    return { state: "entering_water", swimming: true };
  }
  if (a === "transit_out") {
    if (onLand) return { state: "exiting_water", swimming: false };
    return { state: "exiting_water", swimming: true };
  }
  if (a === "hunt") return { state: "hunting", swimming: !onLand };
  if (a === "flee") {
    if (onLand) return { state: meta.moving ? "walking" : "idle", swimming: false };
    return { state: "fleeing", swimming: true };
  }
  if (a === "forage") {
    if (onLand) return { state: meta.moving ? "walking" : "idle", swimming: false };
    return { state: "foraging", swimming: true };
  }
  if (a === "walk") return { state: meta.moving ? "walking" : "idle", swimming: false };
  if (a === "swim") {
    if (onLand) return { state: meta.moving ? "walking" : "idle", swimming: false };
    return { state: "swimming", swimming: true };
  }
  if (!onLand) return { state: "swimming", swimming: true };
  if (meta.moving) return { state: "walking", swimming: false };
  return { state: "idle", swimming: false };
}

function deriveView(meta: CreatureMeta, _store: WorldStore, pos: { x: number; y: number; facing?: number; faceRight?: boolean }): ViewCreature {
  const mapPos = toMap(pos.x, pos.y);
  const onLand = isLandMap(mapPos);
  const { state, swimming } = activityToState(meta, onLand);
  return {
    id: meta.id,
    name: meta.name,
    species: meta.species,
    emotion: deriveEmotion(meta),
    state,
    swimming,
    facing: pos.facing ?? 0,
    faceRight: pos.faceRight ?? true,
  };
}

const ZoneLabel = memo(function ZoneLabel({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <span
      style={{
        position: "absolute",
        left: x,
        top: y,
        fontSize: 14,
        color: "var(--fg-secondary)",
        fontFamily: "var(--font-sans)",
        fontWeight: 700,
        background: "color-mix(in oklch, var(--bg-canvas) 65%, transparent)",
        padding: "4px 12px",
        borderRadius: "var(--radius-pill)",
        pointerEvents: "none",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
});

function feedingFishOpacity(fishDensity: Record<string, number>): number {
  const densities = ["north_bay", "south_shallows"]
    .map((zone) => fishDensity[zone])
    .filter((density): density is number => Number.isFinite(density));
  const density = densities.length === 0 ? 0 : densities.reduce((sum, value) => sum + value, 0) / densities.length;
  // Оставляем едва заметный контур при пустой воде, но при плотности 1
  // используем полную исходную непрозрачность декоративной рыбы.
  return 0.06 + Math.max(0, Math.min(1, density)) * 0.94;
}

const StaticMapLayer = memo(function StaticMapLayer({ fishOpacity }: { fishOpacity: number }) {
  return (
    <>
      <WorldMapSvg />
      {ZONE_LABELS.map((z) => (
        <ZoneLabel key={z.text} x={z.x} y={z.y}>
          {z.text}
        </ZoneLabel>
      ))}
      {FISH.map((f) => (
        <Fish key={f.id} f={f} opacity={fishOpacity} />
      ))}
    </>
  );
});

function reintroductionZonePosition(zone: string | null): { x: number; y: number } | undefined {
  const label = zone === "main_ice" ? "Основной лёд" : zone === "open_water" ? "Открытая вода" : undefined;
  return label ? ZONE_LABELS.find((item) => item.text === label) : undefined;
}

function SignalPulse({ x, y, tone }: { x: number; y: number; tone: string }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, transform: "translate(-50%,-50%)", pointerEvents: "none", zIndex: 4 }}>
      <div
        style={{
          position: "absolute",
          width: 30,
          height: 30,
          marginLeft: -15,
          marginTop: -15,
          borderRadius: "50%",
          border: `2px solid ${tone}`,
          animation: "aur-signal-ring 1.3s ease-out",
        }}
      />
      <div style={{ width: 10, height: 10, borderRadius: "50%", background: tone }} />
    </div>
  );
}

function EventBadge({ x, y, label, tone }: { x: number; y: number; label: string; tone: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y - 36,
        transform: "translate(-50%,-100%)",
        zIndex: 6,
        pointerEvents: "none",
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-pill)",
        padding: "4px 10px",
        boxShadow: "var(--shadow-s)",
        fontFamily: "var(--font-sans)",
        fontSize: 12,
        color: "var(--fg-secondary)",
        whiteSpace: "nowrap",
        animation: "aur-event-badge 2.4s ease-in-out",
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: tone, flex: "none" }} />
      {label}
    </div>
  );
}

export const ObservatoryWorld = memo(function ObservatoryWorld({ store, onSelectCreature, onViewportChange, focusCreatureId }: Props) {
  const [views, setViews] = useState<ViewCreature[]>([]);
  const [events, setEvents] = useState<TimedEvent[]>([]);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [highlight, setHighlight] = useState<HighlightRing | null>(null);
  const [mapScale, setMapScale] = useState(1);
  const [fishOpacity, setFishOpacity] = useState(() => feedingFishOpacity(store.fishDensity));
  const [mountedIds, setMountedIds] = useState<string[]>([]);
  const elCache = useRef(new Map<string, ElCache>());
  const lastMetaRev = useRef(-1);
  const lastEventIds = useRef("");
  const lastLogIds = useRef("");
  const lastFishDensityRevision = useRef(-1);
  const lastMountedKey = useRef("");
  const posCache = useRef(new Map<string, { x: number; y: number }>());
  const panZoomRef = useRef<PanZoomHandle>(null);
  const viewportMap = useRef<MapRect | null>(null);
  const highlightTimer = useRef<number | undefined>(undefined);

  const registerEl = useCallback((id: string, el: HTMLButtonElement | null) => {
    if (!el) {
      elCache.current.delete(id);
      return;
    }
    const facingEl = el.querySelector("[data-facing]") as HTMLElement | null;
    elCache.current.set(id, {
      el,
      facingEl,
      noseLed: el.dataset.noseLed === "1",
      noseX: Number(el.dataset.noseX ?? 0),
      noseY: Number(el.dataset.noseY ?? 0),
    });
  }, []);

  useEffect(() => {
    if (!focusCreatureId) return;
    const positions = store.getPositions(performance.now());
    const pos = positions.find((p) => p.id === focusCreatureId);
    if (!pos) return;
    const map = toMap(pos.x, pos.y);
    panZoomRef.current?.focusOn(map.x, map.y);
  }, [focusCreatureId, store]);

  useEffect(() => {
    let raf = 0;
    let lastEventAt = 0;
    let active = !document.hidden;

    function syncMeta(): void {
      if (store.metaRevision === lastMetaRev.current) return;
      lastMetaRev.current = store.metaRevision;
      const now = performance.now();
      const positions = store.getPositions(now);
      const posMap = new Map(positions.map((p) => [p.id, p]));
      const dirty = store.consumeDirtyMetaIds();

      setViews((prev) => {
        if (prev.length === 0 || dirty.size === 0) {
          return store.listMeta().map((m) => {
            const p = posMap.get(m.id) ?? { x: 0, y: 0, facing: 0, faceRight: true };
            return deriveView(m, store, p);
          });
        }
        const byId = new Map(prev.map((v) => [v.id, v]));
        const aliveIds = new Set(store.listMeta().map((m) => m.id));
        for (const id of [...byId.keys()]) {
          if (!aliveIds.has(id)) byId.delete(id);
        }
        for (const id of dirty) {
          const m = store.getMeta(id);
          if (!m) {
            byId.delete(id);
            continue;
          }
          const p = posMap.get(id) ?? { x: 0, y: 0, facing: 0, faceRight: true };
          byId.set(id, deriveView(m, store, p));
        }
        return [...byId.values()];
      });
    }

    function applyFacing(cache: ElCache, facing: number, faceRight: boolean): void {
      const { facingEl } = cache;
      if (!facingEl) return;
      // Refresh nose flags after React meta re-render (dataset may change).
      cache.noseLed = cache.el.dataset.noseLed === "1";
      cache.noseX = Number(cache.el.dataset.noseX ?? 0);
      cache.noseY = Number(cache.el.dataset.noseY ?? 0);
      if (cache.noseLed) {
        const deg = (facing * 180) / Math.PI + 180;
        facingEl.style.transformOrigin = "0 0";
        facingEl.style.transform = `rotate(${deg}deg) translate(${-cache.noseX}px, ${-cache.noseY}px)`;
      } else {
        facingEl.style.transformOrigin = "50% 50%";
        facingEl.style.transform = faceRight ? "" : "scaleX(-1)";
      }
    }

    function loop(): void {
      if (!active) return;
      const now = performance.now();
      syncMeta();
      if (store.fishDensityRevision !== lastFishDensityRevision.current) {
        lastFishDensityRevision.current = store.fishDensityRevision;
        setFishOpacity(feedingFishOpacity(store.fishDensity));
      }

      const positions = store.getPositions(now);
      const vp = viewportMap.current;
      posCache.current.clear();
      const inViewIds: string[] = [];
      for (const p of positions) {
        const map = toMap(p.x, p.y);
        posCache.current.set(p.id, map);
        const inView =
          !vp ||
          (map.x >= vp.x - VIEWPORT_PAD &&
            map.y >= vp.y - VIEWPORT_PAD &&
            map.x <= vp.x + vp.width + VIEWPORT_PAD &&
            map.y <= vp.y + vp.height + VIEWPORT_PAD);
        if (!inView) continue;
        inViewIds.push(p.id);
        const cache = elCache.current.get(p.id);
        if (cache) {
          const noseLed = cache.el.dataset.noseLed === "1";
          cache.el.style.transform = noseLed
            ? `translate3d(${map.x}px, ${map.y}px, 0)`
            : `translate3d(${map.x}px, ${map.y}px, 0) translate(-50%, -50%)`;
          applyFacing(cache, p.facing, p.faceRight);
        }
      }

      inViewIds.sort();
      const mountKey = inViewIds.join(",");
      if (mountKey !== lastMountedKey.current) {
        lastMountedKey.current = mountKey;
        setMountedIds(inViewIds);
      }

      if (now - lastEventAt > 200) {
        lastEventAt = now;
        const activeEvents = store.getActiveEvents(now);
        const ids = activeEvents.map((e) => e.id).join(",");
        if (ids !== lastEventIds.current) {
          lastEventIds.current = ids;
          setEvents(activeEvents);
        }
        const logEvents = store.getLogEvents(now);
        const logIds = logEvents.map((e) => e.id).join(",");
        if (logIds !== lastLogIds.current) {
          lastLogIds.current = logIds;
          setLogEntries(buildLogEntries(logEvents, (id) => store.creatureName(id)));
        }
      }
      raf = requestAnimationFrame(loop);
    }

    function onVisibilityChange(): void {
      if (document.hidden) {
        active = false;
        cancelAnimationFrame(raf);
        raf = 0;
      } else {
        active = true;
        syncMeta();
        if (!raf) raf = requestAnimationFrame(loop);
      }
    }

    if (active) raf = requestAnimationFrame(loop);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (highlightTimer.current !== undefined) window.clearTimeout(highlightTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  function handleViewportChange(mapRect: MapRect): void {
    viewportMap.current = mapRect;
    const topLeft = toSim(mapRect.x, mapRect.y);
    const bottomRight = toSim(mapRect.x + mapRect.width, mapRect.y + mapRect.height);
    onViewportChange({
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    });
  }

  function focusLogEntry(entry: LogEntry): void {
    let mapPos: { x: number; y: number } | undefined;
    if (entry.actorId) mapPos = posCache.current.get(entry.actorId);
    if (!mapPos && entry.targetId) mapPos = posCache.current.get(entry.targetId);
    if (!mapPos && entry.zone) mapPos = reintroductionZonePosition(entry.zone);
    if (!mapPos && entry.actorId) {
      const positions = store.getPositions(performance.now());
      const p = positions.find((c) => c.id === entry.actorId);
      if (p) mapPos = toMap(p.x, p.y);
    }
    if (!mapPos) return;
    panZoomRef.current?.focusOn(mapPos.x, mapPos.y);
    setHighlight({ x: mapPos.x, y: mapPos.y, nonce: Date.now() });
    if (highlightTimer.current !== undefined) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlight(null), 2200);
  }

  const viewById = new Map(views.map((v) => [v.id, v]));
  const simplified = mapScale < LOD_SCALE_THRESHOLD || views.length > 40;

  return (
    <div className="observatory-world">
      <PanZoom ref={panZoomRef} width={MAP_W} height={MAP_H} onViewportChange={handleViewportChange} onScaleChange={setMapScale}>
        <div style={{ position: "relative", width: MAP_W, height: MAP_H, background: "var(--navy-700)" }}>
          <StaticMapLayer fishOpacity={fishOpacity} />
          {mountedIds.map((id) => {
            const c = viewById.get(id);
            if (!c) return null;
            return (
              <Creature
                key={c.id}
                id={c.id}
                name={c.name}
                species={c.species}
                emotion={c.emotion}
                state={c.state}
                swimming={c.swimming}
                facing={c.facing}
                faceRight={c.faceRight}
                simplified={simplified}
                onClick={onSelectCreature}
                registerEl={registerEl}
              />
            );
          })}
          {events.map((e) => {
            const pulse = signalPulseKind(e.type, e.payload);
            if (pulse === "woken_by_alarm") {
              const targetPos = e.target_id ? posCache.current.get(e.target_id) : undefined;
              const pulsePos = targetPos ?? (e.actor_id ? posCache.current.get(e.actor_id) : undefined);
              if (!pulsePos) return null;
              return <SignalPulse key={e.id} x={pulsePos.x} y={pulsePos.y} tone={SIGNAL_PULSE_TONES.woken_by_alarm} />;
            }
            if (pulse) {
              const actorPos = e.actor_id ? posCache.current.get(e.actor_id) : undefined;
              if (!actorPos) return null;
              const tone = SIGNAL_PULSE_TONES[pulse] ?? "var(--accent-warm)";
              return <SignalPulse key={e.id} x={actorPos.x} y={actorPos.y} tone={tone} />;
            }
            if (!BADGE_EVENT_TYPES.has(e.type)) return null;
            const info = eventInfo(e.type);
            if (!info) return null;
            const actorPos = e.actor_id ? posCache.current.get(e.actor_id) : undefined;
            const zonePos = e.type === "reintroduction" ? reintroductionZonePosition(e.zone) : undefined;
            const badgePos = actorPos ?? zonePos;
            if (!badgePos) return null;
            return <EventBadge key={e.id} x={badgePos.x} y={badgePos.y} label={info.label} tone={info.tone} />;
          })}
          {highlight && (
            <div
              key={`hl-${highlight.nonce}`}
              style={{
                position: "absolute",
                left: highlight.x,
                top: highlight.y,
                width: 64,
                height: 64,
                marginLeft: -32,
                marginTop: -32,
                borderRadius: "50%",
                border: "3px solid var(--accent-primary)",
                animation: "aur-signal-ring 2.1s ease-out",
                pointerEvents: "none",
                zIndex: 7,
              }}
            />
          )}
        </div>
      </PanZoom>
      <EventLog entries={logEntries} onSelect={focusLogEntry} />
    </div>
  );
});
