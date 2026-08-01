import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { fetchSocialGraph, type SocialGraph as SocialGraphDto } from "../api/client";
import { PanZoom } from "../world/PanZoom";

interface Props {
  onSelectCreature: (id: string) => void;
  /** Когда true — refetch графа (вкладка открыта). */
  active?: boolean;
}

interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dragging: boolean;
}

const GRAPH_W = 1600;
const GRAPH_H = 1000;
const PAD = 40;
const CLICK_SLOP = 6;

const EDGE_STROKE: Record<"friend" | "mate" | "kin", string> = {
  friend: "var(--aurora-teal-500)",
  mate: "var(--coral-400)",
  kin: "var(--accent-secondary)",
};

function seedNodes(ids: string[]): Map<string, SimNode> {
  const nodes = new Map<string, SimNode>();
  const n = Math.max(1, ids.length);
  const r = Math.min(GRAPH_W, GRAPH_H) * 0.34;
  ids.forEach((id, i) => {
    const a = (i / n) * Math.PI * 2;
    nodes.set(id, {
      id,
      x: GRAPH_W / 2 + Math.cos(a) * r + (Math.random() - 0.5) * 60,
      y: GRAPH_H / 2 + Math.sin(a) * r + (Math.random() - 0.5) * 60,
      vx: 0,
      vy: 0,
      dragging: false,
    });
  });
  return nodes;
}

export function SocialGraph({ onSelectCreature, active = true }: Props) {
  const [graph, setGraph] = useState<SocialGraphDto | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const nodesRef = useRef<Map<string, SimNode>>(new Map());
  const graphKeyRef = useRef("");
  const nodeElsRef = useRef(new Map<string, HTMLDivElement>());
  const edgeElsRef = useRef(new Map<string, SVGPathElement>());
  const simRef = useRef<{ running: boolean; raf: number | null; wake: () => void; paint: () => void }>({
    running: false,
    raf: null,
    wake: () => undefined,
    paint: () => undefined,
  });
  const dragRef = useRef<{
    id: string;
    lastX: number;
    lastY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const edgesRef = useRef<SocialGraphDto["edges"]>([]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setGraph(null);
    fetchSocialGraph()
      .then((g) => {
        if (!cancelled) setGraph(g);
      })
      .catch(() => {
        if (!cancelled) setGraph({ nodes: [], edges: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  // Rebuild sim nodes when graph topology changes.
  useEffect(() => {
    if (!graph) return;
    const key = graph.nodes.map((n) => n.id).join(",");
    edgesRef.current = graph.edges;
    if (key !== graphKeyRef.current) {
      graphKeyRef.current = key;
      nodesRef.current = seedNodes(graph.nodes.map((n) => n.id));
    }
  }, [graph]);

  useEffect(() => {
    if (!graph || graph.nodes.length === 0) return;
    const nodes = nodesRef.current;

    function paint(): void {
      const bonds = edgesRef.current;
      for (const [id, el] of nodeElsRef.current) {
        const n = nodes.get(id);
        if (!n) continue;
        el.style.left = `${n.x}px`;
        el.style.top = `${n.y}px`;
      }
      bonds.forEach((edge, i) => {
        const kind = edge.kind ?? "friend";
        const key = `${edge.a}-${edge.b}-${kind}`;
        const path = edgeElsRef.current.get(key);
        const a = nodes.get(edge.a);
        const b = nodes.get(edge.b);
        if (!path || !a || !b) return;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const bow = Math.min(40, len * 0.12) * (i % 2 === 0 ? 1 : -1);
        const cx = mx - (dy / len) * bow;
        const cy = my + (dx / len) * bow;
        path.setAttribute("d", `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`);
      });
    }

    function loop(): void {
      const nodeArr = [...nodes.values()];
      const bonds = edgesRef.current;

      for (let i = 0; i < nodeArr.length; i++) {
        for (let j = i + 1; j < nodeArr.length; j++) {
          const A = nodeArr[i]!;
          const B = nodeArr[j]!;
          let dx = A.x - B.x;
          let dy = A.y - B.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) d2 = 1;
          const d = Math.sqrt(d2);
          const f = 2400 / d2;
          const fx = (dx / d) * f;
          const fy = (dy / d) * f;
          if (!A.dragging) {
            A.vx += fx;
            A.vy += fy;
          }
          if (!B.dragging) {
            B.vx -= fx;
            B.vy -= fy;
          }
        }
      }

      for (const b of bonds) {
        const A = nodes.get(b.a);
        const B = nodes.get(b.b);
        if (!A || !B) continue;
        let dx = B.x - A.x;
        let dy = B.y - A.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const rest = 150;
        const k = 0.018 * (b.strength || 0.6);
        const f = (d - rest) * k;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        if (!A.dragging) {
          A.vx += fx;
          A.vy += fy;
        }
        if (!B.dragging) {
          B.vx -= fx;
          B.vy -= fy;
        }
      }

      let ke = 0;
      let anyDragging = false;
      for (const n of nodeArr) {
        if (n.dragging) {
          anyDragging = true;
          continue;
        }
        n.vx += (GRAPH_W / 2 - n.x) * 0.0008;
        n.vy += (GRAPH_H / 2 - n.y) * 0.0008;
        n.vx *= 0.86;
        n.vy *= 0.86;
        n.x += n.vx;
        n.y += n.vy;
        n.x = Math.max(PAD, Math.min(GRAPH_W - PAD, n.x));
        n.y = Math.max(PAD, Math.min(GRAPH_H - PAD, n.y));
        ke += n.vx * n.vx + n.vy * n.vy;
      }

      paint();
      if (ke < 0.04 && !anyDragging) {
        simRef.current.running = false;
        simRef.current.raf = null;
        return;
      }
      simRef.current.raf = requestAnimationFrame(loop);
    }

    function startSim(): void {
      if (simRef.current.running) return;
      simRef.current.running = true;
      loop();
    }

    simRef.current.wake = startSim;
    simRef.current.paint = paint;
    paint();
    startSim();
    return () => {
      simRef.current.running = false;
      if (simRef.current.raf != null) cancelAnimationFrame(simRef.current.raf);
      simRef.current.raf = null;
    };
  }, [graph]);

  function onNodeDown(id: string, e: ReactPointerEvent<HTMLDivElement>): void {
    e.stopPropagation();
    const n = nodesRef.current.get(id);
    if (!n) return;
    n.dragging = true;
    n.vx = 0;
    n.vy = 0;
    dragRef.current = {
      id,
      lastX: e.clientX,
      lastY: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    simRef.current.wake();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onNodeMove(e: ReactPointerEvent<HTMLDivElement>): void {
    const d = dragRef.current;
    if (!d) return;
    const canvas = e.currentTarget.closest("[data-graph-canvas]");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / GRAPH_W || 1;
    const n = nodesRef.current.get(d.id);
    if (!n) return;
    const dx = e.clientX - d.lastX;
    const dy = e.clientY - d.lastY;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > CLICK_SLOP) {
      d.moved = true;
    }
    n.x = Math.max(PAD, Math.min(GRAPH_W - PAD, n.x + dx / scale));
    n.y = Math.max(PAD, Math.min(GRAPH_H - PAD, n.y + dy / scale));
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    simRef.current.paint();
  }

  function onNodeUp(id: string, e: ReactPointerEvent<HTMLDivElement>): void {
    const d = dragRef.current;
    const n = nodesRef.current.get(id);
    if (n) n.dragging = false;
    const wasClick = d && d.id === id && !d.moved;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    simRef.current.wake();
    if (wasClick) onSelectCreature(id);
  }

  const nodes = nodesRef.current;
  const neighborIds = (() => {
    if (!hoverId || !graph) return null;
    const s = new Set<string>([hoverId]);
    for (const b of graph.edges) {
      if (b.a === hoverId) s.add(b.b);
      if (b.b === hoverId) s.add(b.a);
    }
    return s;
  })();

  return (
    <div className="social-view">
      <div className="social-view__intro">
        <h2>Кто с кем дружит</h2>
        <p>Граф связей текущей популяции — цвет линии показывает тип отношений.</p>
        <div className="social-view__legend" aria-label="Типы связей">
          <span className="social-view__legend-item">
            <i style={{ background: EDGE_STROKE.friend }} />
            Дружба
          </span>
          <span className="social-view__legend-item">
            <i style={{ background: EDGE_STROKE.mate }} />
            Любовь
          </span>
          <span className="social-view__legend-item">
            <i style={{ background: EDGE_STROKE.kin }} />
            Родство
          </span>
        </div>
      </div>
      {!graph && <p className="social-view__loading">Загрузка…</p>}
      {graph && graph.nodes.length === 0 && <p className="social-view__loading">Пока нет дружеских связей.</p>}
      {graph && graph.nodes.length > 0 && (
        <div className="social-view__canvas">
          <PanZoom width={GRAPH_W} height={GRAPH_H} maxScale={3}>
            <div
              data-graph-canvas
              style={{
                position: "relative",
                width: GRAPH_W,
                height: GRAPH_H,
                background:
                  "radial-gradient(circle at 50% 40%, color-mix(in oklch, var(--accent-primary) 6%, var(--bg-canvas)), var(--bg-canvas))",
              }}
            >
              <svg
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
                aria-hidden
              >
                {graph.edges.map((edge, i) => {
                  const a = nodes.get(edge.a);
                  const b = nodes.get(edge.b);
                  if (!a || !b) return null;
                  const dim = neighborIds && !(neighborIds.has(edge.a) && neighborIds.has(edge.b));
                  const mx = (a.x + b.x) / 2;
                  const my = (a.y + b.y) / 2;
                  const dx = b.x - a.x;
                  const dy = b.y - a.y;
                  const len = Math.hypot(dx, dy) || 1;
                  const bow = Math.min(40, len * 0.12) * (i % 2 === 0 ? 1 : -1);
                  const cx = mx - (dy / len) * bow;
                  const cy = my + (dx / len) * bow;
                  const kind = edge.kind ?? "friend";
                  const key = `${edge.a}-${edge.b}-${kind}`;
                  return (
                    <path
                      key={key}
                      ref={(el) => {
                        if (el) edgeElsRef.current.set(key, el);
                        else edgeElsRef.current.delete(key);
                      }}
                      d={`M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`}
                      fill="none"
                      stroke={EDGE_STROKE[kind]}
                      strokeWidth={1.2 + edge.strength * 2.4}
                      opacity={dim ? 0.08 : 0.35 + edge.strength * 0.4}
                      style={{ transition: "opacity 0.25s ease" }}
                    />
                  );
                })}
              </svg>
              {graph.nodes.map((node) => {
                const n = nodes.get(node.id);
                if (!n) return null;
                const dim = neighborIds && !neighborIds.has(node.id);
                const hovered = hoverId === node.id;
                return (
                  <div
                    key={node.id}
                    ref={(el) => {
                      if (el) nodeElsRef.current.set(node.id, el);
                      else nodeElsRef.current.delete(node.id);
                    }}
                    role="button"
                    aria-label={node.name}
                    tabIndex={0}
                    data-no-pan
                    onPointerDown={(e) => onNodeDown(node.id, e)}
                    onPointerMove={onNodeMove}
                    onPointerUp={(e) => onNodeUp(node.id, e)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectCreature(node.id);
                      }
                    }}
                    onMouseEnter={() => setHoverId(node.id)}
                    onMouseLeave={() => setHoverId(null)}
                    style={{
                      position: "absolute",
                      left: n.x,
                      top: n.y,
                      transform: `translate(-50%,-50%) scale(${hovered ? 1.12 : 1})`,
                      cursor: n.dragging ? "grabbing" : "grab",
                      opacity: dim ? 0.3 : 1,
                      transition: "opacity 0.25s ease, transform 0.15s ease",
                      zIndex: hovered ? 3 : 1,
                      touchAction: "none",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 4,
                      userSelect: "none",
                    }}
                  >
                    <div
                      className={
                        node.species === "orca" ? "social-graph__node-orca social-graph__node" : "social-graph__node-penguin social-graph__node"
                      }
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        border: "2px solid var(--aurora-teal-500)",
                        boxSizing: "border-box",
                      }}
                    />
                    <span
                      className="social-graph__label"
                      style={{
                        fontSize: 11,
                        fontFamily: "var(--font-sans)",
                        color: "var(--fg-secondary)",
                        whiteSpace: "nowrap",
                        pointerEvents: "none",
                      }}
                    >
                      {node.name}
                    </span>
                  </div>
                );
              })}
            </div>
          </PanZoom>
        </div>
      )}
    </div>
  );
}
