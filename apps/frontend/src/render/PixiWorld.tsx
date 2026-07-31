import { useEffect, useRef } from "react";
import { Application, Container, Graphics, Text } from "pixi.js";
import type { WorldStore, RenderCreature, TimedEvent } from "../ws/WorldStore";
import { bodyColorFor, emotionColorFor, emotionRadiusFor, radiusFor, SIGNAL_COLORS } from "./creatureVisual";

const ZONE_FILL: Record<string, number> = {
  ice: 0xe7f0f6, // --ice-100
  water: 0x1c4054, // --navy-600
};

interface Props {
  store: WorldStore;
  onSelectCreature: (id: string) => void;
  onViewportChange: (vp: { x: number; y: number; width: number; height: number }) => void;
}

interface CreatureNode {
  container: Container;
  body: Graphics;
  emotionDot: Graphics;
  sleepMark: Text;
}

const MIN_SCALE = 0.15;
const MAX_SCALE = 3;
/** Ночное затемнение сцены (6.1: "смена дня и ночи видна визуально") — доля непрозрачности оверлея в полной темноте. */
const NIGHT_OVERLAY_ALPHA = 0.6;
/** Скорость сходимости альфы оверлея к целевому значению за кадр — плавный переход, а не резкий щелчок day/night. */
const NIGHT_TRANSITION_RATE = 0.03;

export function PixiWorld({ store, onSelectCreature, onViewportChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let destroyed = false;

    const app = new Application();
    const world = new Container();
    const zonesLayer = new Graphics();
    const eventsLayer = new Graphics();
    const creaturesLayer = new Container();
    const nightOverlay = new Graphics();
    const creatureNodes = new Map<string, CreatureNode>();
    let zonesDrawn = false;
    let nightAlpha = 0;

    let dragging = false;
    let dragStart = { x: 0, y: 0 };
    let containerStart = { x: 0, y: 0 };

    function emitViewport(): void {
      const scale = world.scale.x || 1;
      const w = app.screen.width / scale;
      const h = app.screen.height / scale;
      const x = -world.position.x / scale;
      const y = -world.position.y / scale;
      onViewportChange({ x, y, width: w, height: h });
    }

    function drawZonesOnce(): void {
      if (zonesDrawn || store.zones.length === 0) return;
      zonesLayer.clear();
      for (const zone of store.zones) {
        zonesLayer
          .rect(zone.x0, zone.y0, zone.x1 - zone.x0, zone.y1 - zone.y0)
          .fill({ color: ZONE_FILL[zone.type] ?? 0x333333, alpha: 0.9 });
      }
      zonesDrawn = true;
    }

    function ensureCreatureNode(id: string): CreatureNode {
      let node = creatureNodes.get(id);
      if (node) return node;
      const container = new Container();
      const body = new Graphics();
      const emotionDot = new Graphics();
      const sleepMark = new Text({ text: "z", style: { fill: 0x2a3b4d, fontSize: 12, fontWeight: "bold" } });
      sleepMark.anchor.set(0.5);
      sleepMark.visible = false;
      container.addChild(body, emotionDot, sleepMark);
      container.eventMode = "static";
      container.cursor = "pointer";
      container.on("pointertap", () => onSelectCreature(id));
      creaturesLayer.addChild(container);
      node = { container, body, emotionDot, sleepMark };
      creatureNodes.set(id, node);
      return node;
    }

    function drawCreature(c: RenderCreature): void {
      const node = ensureCreatureNode(c.id);
      node.container.position.set(c.renderX, c.renderY);

      const r = radiusFor(c);
      node.body.clear();
      node.body.circle(0, 0, r).fill(bodyColorFor(c));
      // Спящие визуально отличимы: приглушённая заливка (bodyColorFor) +
      // полупрозрачное тело + метка "z" (6.1: "видно, кто спит").
      node.body.alpha = c.is_asleep ? 0.55 : 1;
      node.sleepMark.visible = c.is_asleep;
      node.sleepMark.position.set(r * 0.7, -r * 0.7);

      // Индикатор эмоции — цвет по валентности, размер по возбуждению (6.1: "индикаторы эмоции на существах").
      node.emotionDot.clear();
      node.emotionDot.circle(0, -r - 5, emotionRadiusFor(c)).fill(emotionColorFor(c));
    }

    function pruneCreatureNodes(activeIds: Set<string>): void {
      for (const [id, node] of creatureNodes) {
        if (!activeIds.has(id)) {
          creaturesLayer.removeChild(node.container);
          node.container.destroy({ children: true });
          creatureNodes.delete(id);
        }
      }
    }

    function drawEvents(events: TimedEvent[], now: number, positions: Map<string, { x: number; y: number }>): void {
      eventsLayer.clear();
      for (const event of events) {
        const color = SIGNAL_COLORS[event.type];
        const isDeathLike = event.type === "death" || event.type === "hunt_success";
        if (!color && !isDeathLike) continue;
        const pos = event.actor_id ? positions.get(event.actor_id) : undefined;
        if (!pos) continue;
        const age = (now - event.receivedAt) / 2500;
        const t = Math.min(1, Math.max(0, age));

        if (isDeathLike) {
          // Мягкая, нереалистичная стилизация смерти (6.1): расходящееся
          // светлое облако, без крови/натурализма.
          const radius = 8 + t * 26;
          eventsLayer.circle(pos.x, pos.y, radius).fill({ color: 0xffffff, alpha: (1 - t) * 0.5 });
        } else {
          // Сигнал/тревога — расширяющееся кольцо (6.1: "alarm_call и
          // display_vigor заметны на карте").
          const radius = 10 + t * 40;
          eventsLayer.circle(pos.x, pos.y, radius).stroke({ width: 3, color, alpha: 1 - t });
        }
      }
    }

    let resizeObserver: ResizeObserver | undefined;

    void app
      .init({ backgroundColor: 0x0b1a24, antialias: true, resizeTo: host })
      .then(() => {
        if (destroyed) {
          app.destroy(true, { children: true });
          return;
        }
        host.appendChild(app.canvas);
        world.addChild(zonesLayer, eventsLayer, creaturesLayer);
        app.stage.addChild(world, nightOverlay);
        world.position.set(40, 40);

        app.stage.eventMode = "static";
        app.stage.hitArea = app.screen;
        app.stage.on("pointerdown", (e) => {
          dragging = true;
          dragStart = { x: e.global.x, y: e.global.y };
          containerStart = { x: world.position.x, y: world.position.y };
        });
        app.stage.on("pointerup", () => (dragging = false));
        app.stage.on("pointerupoutside", () => (dragging = false));
        app.stage.on("pointermove", (e) => {
          if (!dragging) return;
          world.position.set(containerStart.x + (e.global.x - dragStart.x), containerStart.y + (e.global.y - dragStart.y));
          emitViewport();
        });
        app.canvas.addEventListener(
          "wheel",
          (e: WheelEvent) => {
            e.preventDefault();
            const before = { x: (e.offsetX - world.position.x) / world.scale.x, y: (e.offsetY - world.position.y) / world.scale.y };
            const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
            const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, world.scale.x * factor));
            world.scale.set(nextScale);
            world.position.set(e.offsetX - before.x * nextScale, e.offsetY - before.y * nextScale);
            emitViewport();
          },
          { passive: false },
        );

        resizeObserver = new ResizeObserver(() => emitViewport());
        resizeObserver.observe(host);

        app.ticker.add(() => {
          drawZonesOnce();
          const now = performance.now();
          const renderState = store.getRenderState(now);
          const positions = new Map<string, { x: number; y: number }>();
          const activeIds = new Set<string>();
          for (const c of renderState) {
            drawCreature(c);
            positions.set(c.id, { x: c.renderX, y: c.renderY });
            activeIds.add(c.id);
          }
          pruneCreatureNodes(activeIds);
          drawEvents(store.getActiveEvents(now), now, positions);

          const targetAlpha = store.phase === "night" ? NIGHT_OVERLAY_ALPHA : 0;
          nightAlpha += (targetAlpha - nightAlpha) * NIGHT_TRANSITION_RATE;
          nightOverlay.clear();
          if (nightAlpha > 0.001) {
            nightOverlay.rect(0, 0, app.screen.width, app.screen.height).fill({ color: 0x02060c, alpha: nightAlpha });
          }
        });

        emitViewport();
      })
      .catch((err) => console.error("[frontend] не удалось инициализировать PixiJS:", err));

    return () => {
      destroyed = true;
      resizeObserver?.disconnect();
      if (app.renderer) app.destroy(true, { children: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />;
}
