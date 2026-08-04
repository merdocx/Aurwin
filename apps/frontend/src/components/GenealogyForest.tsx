import { useEffect, useMemo, useRef, useState } from "react";
import { fetchGenealogy, type GenealogyNode } from "../api/client";

interface Props {
  onSelectCreature: (id: string) => void;
  active?: boolean;
}

interface LaidOutNode {
  id: string;
  x: number;
  y: number;
  node: GenealogyNode;
}

interface LaidOutEdge {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: "descent" | "mate";
}

interface SpeciesLayout {
  species: "penguin" | "orca";
  label: string;
  width: number;
  height: number;
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
}

const NODE_W = 72;
const NODE_H = 26;
const H_GAP = 6;
const V_GAP = 48;
const SUB_ROW_GAP = 8;
const PAD_X = 16;
const PAD_Y = 20;
const LABEL_H = 28;
const COL_GAP = 20;
const MIN_CENTER_GAP = NODE_W + H_GAP;
/** Порог, после которого стоит virtualize узлы древа (задел под perf). */
const VIRTUALIZE_AT = 200;

const SPECIES_LABEL: Record<"penguin" | "orca", string> = {
  penguin: "Пингвины",
  orca: "Касатки",
};

function assignDepths(nodes: GenealogyNode[]): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = new Map<string, number>();
  const visiting = new Set<string>();

  function depthOf(id: string): number {
    if (depth.has(id)) return depth.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const n = byId.get(id);
    if (!n) {
      visiting.delete(id);
      return 0;
    }
    const pa = n.parent_a && byId.has(n.parent_a) ? depthOf(n.parent_a) : -1;
    const pb = n.parent_b && byId.has(n.parent_b) ? depthOf(n.parent_b) : -1;
    const d = Math.max(pa, pb) + 1;
    depth.set(id, d);
    visiting.delete(id);
    return d;
  }

  for (const n of nodes) depthOf(n.id);
  return depth;
}

function childrenMap(nodes: GenealogyNode[]): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    for (const p of [n.parent_a, n.parent_b]) {
      if (!p) continue;
      const list = children.get(p) ?? [];
      if (!list.includes(n.id)) list.push(n.id);
      children.set(p, list);
    }
  }
  for (const [, list] of children) {
    list.sort((a, b) => {
      const na = nodes.find((x) => x.id === a)!;
      const nb = nodes.find((x) => x.id === b)!;
      return na.born_at_tick - nb.born_at_tick || na.name.localeCompare(nb.name, "ru");
    });
  }
  return children;
}

function descendantCount(id: string, children: Map<string, string[]>, memo: Map<string, number>): number {
  if (memo.has(id)) return memo.get(id)!;
  const kids = children.get(id) ?? [];
  let n = kids.length;
  for (const k of kids) n += descendantCount(k, children, memo);
  memo.set(id, n);
  return n;
}

/** Единицы раскладки: одиночка или пара — чтобы не рвать пары при переносе. */
function toUnits(row: GenealogyNode[], mateOf: Map<string, string>): GenealogyNode[][] {
  const units: GenealogyNode[][] = [];
  const seen = new Set<string>();
  for (const n of row) {
    if (seen.has(n.id)) continue;
    const mateId = mateOf.get(n.id);
    const mate = mateId ? row.find((x) => x.id === mateId) : undefined;
    if (mate && !seen.has(mate.id)) {
      const pair = [n, mate].sort((a, b) => a.name.localeCompare(b.name, "ru"));
      units.push(pair);
      seen.add(pair[0]!.id);
      seen.add(pair[1]!.id);
    } else {
      units.push([n]);
      seen.add(n.id);
    }
  }
  return units;
}

function chunkUnits(units: GenealogyNode[][], maxPerRow: number): GenealogyNode[][] {
  const chunks: GenealogyNode[][] = [];
  let cur: GenealogyNode[] = [];
  for (const unit of units) {
    if (cur.length > 0 && cur.length + unit.length > maxPerRow) {
      chunks.push(cur);
      cur = [];
    }
    // Если пара шире лимита — всё равно кладём целиком на свой ряд.
    if (unit.length > maxPerRow && cur.length === 0) {
      chunks.push(unit);
      continue;
    }
    cur.push(...unit);
  }
  if (cur.length) chunks.push(cur);
  return chunks.length ? chunks : [[]];
}

/** Равномерно заполняет ширину колонки — без выхода за края. */
function xAcross(count: number, colWidth: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [colWidth / 2];
  const inner = Math.max(colWidth - PAD_X * 2, NODE_W);
  const step = (inner - NODE_W) / (count - 1);
  const start = PAD_X + NODE_W / 2;
  return Array.from({ length: count }, (_, i) => start + i * step);
}

function layoutSpecies(nodes: GenealogyNode[], species: "penguin" | "orca", colWidth: number): SpeciesLayout | null {
  const group = nodes.filter((n) => n.species === species);
  if (group.length === 0) return null;

  const byId = new Map(group.map((n) => [n.id, n]));
  const depths = assignDepths(group);
  const children = childrenMap(group);
  const maxDepth = Math.max(0, ...[...depths.values()]);
  const descMemo = new Map<string, number>();

  const mateOf = new Map<string, string>();
  for (const n of group) {
    const a = n.parent_a;
    const b = n.parent_b;
    if (a && b && byId.has(a) && byId.has(b) && a !== b) {
      if (!mateOf.has(a)) mateOf.set(a, b);
      if (!mateOf.has(b)) mateOf.set(b, a);
    }
  }

  const byDepth = new Map<number, GenealogyNode[]>();
  for (const n of group) {
    const d = depths.get(n.id) ?? 0;
    const list = byDepth.get(d) ?? [];
    list.push(n);
    byDepth.set(d, list);
  }

  {
    const row = byDepth.get(0) ?? [];
    const withKids = row.filter((n) => (children.get(n.id) ?? []).some((c) => byId.has(c)));
    const alone = row.filter((n) => !(children.get(n.id) ?? []).some((c) => byId.has(c)));
    withKids.sort(
      (a, b) =>
        descendantCount(b.id, children, descMemo) - descendantCount(a.id, children, descMemo) ||
        a.born_at_tick - b.born_at_tick ||
        a.name.localeCompare(b.name, "ru"),
    );
    alone.sort((a, b) => a.born_at_tick - b.born_at_tick || a.name.localeCompare(b.name, "ru"));
    byDepth.set(0, [...toUnits([...withKids, ...alone], mateOf).flat()]);
  }

  for (let d = 1; d <= maxDepth; d++) {
    const row = byDepth.get(d) ?? [];
    row.sort((a, b) => {
      const parentKey = (n: GenealogyNode): number => {
        const ps = [n.parent_a, n.parent_b]
          .map((id) => (id ? byId.get(id) : undefined))
          .filter((p): p is GenealogyNode => !!p);
        if (ps.length === 0) return n.born_at_tick;
        return ps.reduce((s, p) => s + p.born_at_tick, 0) / ps.length;
      };
      return parentKey(a) - parentKey(b) || a.born_at_tick - b.born_at_tick || a.name.localeCompare(b.name, "ru");
    });
    byDepth.set(d, toUnits(row, mateOf).flat());
  }

  const innerW = Math.max(colWidth - PAD_X * 2, NODE_W);
  const maxPerRow = Math.max(1, Math.floor((innerW + H_GAP) / MIN_CENTER_GAP));

  const pos = new Map<string, { x: number; y: number }>();
  let yCursor = PAD_Y + LABEL_H;

  for (let d = 0; d <= maxDepth; d++) {
    const row = byDepth.get(d) ?? [];
    const chunks = chunkUnits(toUnits(row, mateOf), maxPerRow);
    chunks.forEach((chunk, ci) => {
      const xs = xAcross(chunk.length, colWidth);
      const y = yCursor + ci * (NODE_H + SUB_ROW_GAP);
      chunk.forEach((n, i) => {
        pos.set(n.id, { x: xs[i]!, y });
      });
    });
    const bandH = Math.max(1, chunks.length) * NODE_H + Math.max(0, chunks.length - 1) * SUB_ROW_GAP;
    yCursor += bandH + V_GAP;
  }

  // Подтянуть детей к барицентру родителей по X, не выходя за колонку.
  for (let iter = 0; iter < 6; iter++) {
    for (let d = 1; d <= maxDepth; d++) {
      const row = byDepth.get(d) ?? [];
      const chunks = chunkUnits(toUnits(row, mateOf), maxPerRow);
      for (const chunk of chunks) {
        const desired = chunk.map((n) => {
          const parents = [n.parent_a, n.parent_b].filter((p): p is string => !!p && pos.has(p));
          if (parents.length === 0) return pos.get(n.id)!.x;
          return parents.reduce((s, p) => s + pos.get(p)!.x, 0) / parents.length;
        });
        // Сохранить порядок, уложить в ширину колонки относительно желаемого среднего.
        const order = desired
          .map((x, i) => ({ x, i }))
          .sort((a, b) => a.x - b.x || a.i - b.i);
        const slots = xAcross(chunk.length, colWidth);
        // Назначить слоты слева направо отсортированным желаниям.
        order.forEach((o, slot) => {
          pos.get(chunk[o.i]!.id)!.x = slots[slot]!;
        });
      }
    }
  }

  let maxY = 0;
  for (const p of pos.values()) maxY = Math.max(maxY, p.y + NODE_H / 2);

  const laid: LaidOutNode[] = [];
  for (const n of group) {
    const p = pos.get(n.id);
    if (!p) continue;
    laid.push({ id: n.id, x: p.x, y: p.y, node: n });
  }

  const posById = new Map(laid.map((n) => [n.id, n]));
  const edges: LaidOutEdge[] = [];
  const mateDrawn = new Set<string>();

  for (const [a, b] of mateOf) {
    const key = [a, b].sort().join("|");
    if (mateDrawn.has(key)) continue;
    mateDrawn.add(key);
    const pa = posById.get(a);
    const pb = posById.get(b);
    if (!pa || !pb) continue;
    edges.push({
      key: `mate-${key}`,
      x1: pa.x,
      y1: pa.y + NODE_H / 2,
      x2: pb.x,
      y2: pb.y + NODE_H / 2,
      kind: "mate",
    });
  }

  for (const n of group) {
    for (const p of [n.parent_a, n.parent_b]) {
      if (!p || !posById.has(p) || !posById.has(n.id)) continue;
      const a = posById.get(p)!;
      const b = posById.get(n.id)!;
      edges.push({
        key: `${p}->${n.id}`,
        x1: a.x,
        y1: a.y + NODE_H / 2,
        x2: b.x,
        y2: b.y - NODE_H / 2,
        kind: "descent",
      });
    }
  }

  return {
    species,
    label: SPECIES_LABEL[species],
    width: colWidth,
    height: maxY + PAD_Y,
    nodes: laid,
    edges,
  };
}

function layoutForest(
  nodes: GenealogyNode[],
  totalWidth: number,
): { sections: SpeciesLayout[]; width: number; height: number; dividerX: number | null } {
  const width = Math.max(320, Math.floor(totalWidth));
  const penguinNodes = nodes.filter((n) => n.species === "penguin").length;
  const orcaNodes = nodes.filter((n) => n.species === "orca").length;
  const hasBoth = penguinNodes > 0 && orcaNodes > 0;

  let penguinW: number;
  let orcaW: number;
  if (!hasBoth) {
    penguinW = penguinNodes ? width : 0;
    orcaW = orcaNodes ? width : 0;
  } else {
    // Касаткам минимум ~22%, пингвинам остальное — по числу особей.
    const orcaShare = Math.min(0.34, Math.max(0.2, orcaNodes / (penguinNodes + orcaNodes) + 0.12));
    orcaW = Math.floor((width - COL_GAP) * orcaShare);
    penguinW = width - COL_GAP - orcaW;
  }

  const penguin = penguinW > 0 ? layoutSpecies(nodes, "penguin", penguinW) : null;
  const orca = orcaW > 0 ? layoutSpecies(nodes, "orca", orcaW) : null;
  const raw = [penguin, orca].filter((s): s is SpeciesLayout => !!s);
  if (raw.length === 0) return { sections: [], width, height: 240, dividerX: null };

  const height = Math.max(...raw.map((s) => s.height), 240);
  let xOff = 0;
  const sections: SpeciesLayout[] = [];
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i]!;
    sections.push({
      ...s,
      height,
      nodes: s.nodes.map((n) => ({ ...n, x: n.x + xOff })),
      edges: s.edges.map((e) => ({ ...e, x1: e.x1 + xOff, x2: e.x2 + xOff })),
    });
    xOff += s.width + (i < raw.length - 1 ? COL_GAP : 0);
  }

  return {
    sections,
    width,
    height,
    dividerX: raw.length === 2 ? raw[0]!.width + COL_GAP / 2 : null,
  };
}

function edgePath(e: LaidOutEdge): string {
  if (e.kind === "mate") {
    const midY = Math.max(e.y1, e.y2) + 10;
    return `M ${e.x1} ${e.y1} L ${e.x1} ${midY} L ${e.x2} ${midY} L ${e.x2} ${e.y2}`;
  }
  const cy = (e.y1 + e.y2) / 2;
  return `M ${e.x1} ${e.y1} C ${e.x1} ${cy}, ${e.x2} ${cy}, ${e.x2} ${e.y2}`;
}

export function GenealogyForest({ onSelectCreature, active = true }: Props) {
  const [nodes, setNodes] = useState<GenealogyNode[] | null>(null);
  const [canvasW, setCanvasW] = useState(0);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    function load() {
      fetchGenealogy()
        .then((g) => {
          if (!cancelled) setNodes(g.nodes);
        })
        .catch(() => {
          if (!cancelled) setNodes([]);
        });
    }
    load();
    // Poll только пока вкладка активна (effect cleanup). При истории >VIRTUALIZE_AT
    // узлов имеет смысл virtualize DOM; пока кладём все узлы (десятки).
    const id = window.setInterval(load, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const el = canvasRef.current;
    if (!el) return;
    function measure(): void {
      const w = canvasRef.current?.clientWidth ?? 0;
      if (w > 0) setCanvasW(w);
    }
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, nodes]);

  const forest = useMemo(() => {
    if (!nodes || canvasW <= 0) return null;
    return layoutForest(nodes, canvasW);
  }, [nodes, canvasW]);

  if (!active) return null;
  if (!nodes) {
    return (
      <div className="genealogy-view">
        <p className="genealogy-view__loading">Загрузка древа…</p>
      </div>
    );
  }
  if (nodes.length === 0) {
    return (
      <div className="genealogy-view">
        <p className="genealogy-view__loading">Пока нет существ для древа</p>
      </div>
    );
  }

  const alive = nodes.filter((n) => n.alive).length;
  const dead = nodes.length - alive;
  const denseHistory = nodes.length >= VIRTUALIZE_AT;

  return (
    <div className="genealogy-view">
      <div className="genealogy-view__intro">
        <h2>Родословная мира</h2>
        <p>
          Пингвины слева, касатки справа. Сверху основатели, ниже поколения. Узлы с † покинули мир, но остаются в линии.
          {denseHistory ? " История большая — при тормозах обновите вкладку." : ""}
        </p>
        <div className="genealogy-view__legend">
          <span className="genealogy-view__legend-item">
            <i className="genealogy-view__swatch genealogy-view__swatch--live" />
            Живые · {alive}
          </span>
          <span className="genealogy-view__legend-item">
            <i className="genealogy-view__swatch genealogy-view__swatch--dead" />
            Покинули · {dead}
          </span>
          <span className="genealogy-view__legend-item">
            <i className="genealogy-view__swatch genealogy-view__swatch--mate" />
            Пара
          </span>
          <span className="genealogy-view__legend-item">
            <i className="genealogy-view__swatch genealogy-view__swatch--kin" />
            Родство
          </span>
        </div>
      </div>

      <div className="genealogy-view__canvas" ref={canvasRef}>
        {forest && forest.sections.length > 0 && (
          <div className="genealogy-forest__scene" style={{ width: forest.width, height: forest.height }}>
            <svg className="genealogy-forest__svg" width={forest.width} height={forest.height} aria-hidden>
              <defs>
                <linearGradient id="gen-scene-fade" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--aurora-teal-500)" stopOpacity="0.07" />
                  <stop offset="55%" stopColor="var(--navy-800)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <rect width={forest.width} height={forest.height} fill="url(#gen-scene-fade)" />

              {forest.dividerX != null && (
                <line
                  className="genealogy-forest__divider"
                  x1={forest.dividerX}
                  y1={16}
                  x2={forest.dividerX}
                  y2={forest.height - 16}
                />
              )}

              {forest.sections.map((section) => {
                const xs = section.nodes.map((n) => n.x);
                const labelX = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : section.width / 2;
                return (
                  <text key={`title-${section.species}`} className="genealogy-forest__title" x={labelX} y={22} textAnchor="middle">
                    {section.label}
                  </text>
                );
              })}

              {forest.sections.flatMap((section) =>
                section.edges.map((e) => (
                  <path
                    key={e.key}
                    className={
                      e.kind === "mate" ? "genealogy-forest__edge genealogy-forest__edge--mate" : "genealogy-forest__edge"
                    }
                    d={edgePath(e)}
                    fill="none"
                  />
                )),
              )}
            </svg>

            {forest.sections.flatMap((section) =>
              section.nodes.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={[
                    "genealogy-forest__node",
                    `genealogy-forest__node--${n.node.species}`,
                    n.node.alive ? "genealogy-forest__node--live" : "genealogy-forest__node--dead",
                  ].join(" ")}
                  style={{
                    left: n.x - NODE_W / 2,
                    top: n.y - NODE_H / 2,
                    width: NODE_W,
                    height: NODE_H,
                  }}
                  onClick={() => onSelectCreature(n.id)}
                  title={n.node.alive ? n.node.name : `${n.node.name} (покинул мир)`}
                >
                  <span className="genealogy-forest__name">{n.node.name}</span>
                  <span className="genealogy-forest__meta">
                    {n.node.sex === "m" ? "♂" : "♀"}
                    {!n.node.alive ? " †" : ""}
                  </span>
                </button>
              )),
            )}
          </div>
        )}
      </div>
    </div>
  );
}
