import { useEffect, useMemo, useState } from "react";
import { fetchGenealogy, type GenealogyNode } from "../api/client";
import { PanZoom } from "../world/PanZoom";

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
}

interface SpeciesLayout {
  species: "penguin" | "orca";
  label: string;
  width: number;
  height: number;
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
}

const NODE_W = 112;
const NODE_H = 36;
const H_GAP = 28;
const V_GAP = 72;
const SECTION_GAP = 64;
const PAD = 48;

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

/** Рекурсивная ширина поддерева (для корней с потомками). */
function subtreeWidth(id: string, children: Map<string, string[]>, memo: Map<string, number>): number {
  if (memo.has(id)) return memo.get(id)!;
  const kids = children.get(id) ?? [];
  if (kids.length === 0) {
    memo.set(id, NODE_W);
    return NODE_W;
  }
  let w = 0;
  for (let i = 0; i < kids.length; i++) {
    w += subtreeWidth(kids[i]!, children, memo);
    if (i < kids.length - 1) w += H_GAP;
  }
  w = Math.max(NODE_W, w);
  memo.set(id, w);
  return w;
}

function layoutSpecies(nodes: GenealogyNode[], species: "penguin" | "orca"): SpeciesLayout | null {
  const group = nodes.filter((n) => n.species === species);
  if (group.length === 0) return null;

  const byId = new Map(group.map((n) => [n.id, n]));
  const depths = assignDepths(group);
  const children = childrenMap(group);
  const widthMemo = new Map<string, number>();

  const roots = group
    .filter((n) => {
      const hasA = n.parent_a && byId.has(n.parent_a);
      const hasB = n.parent_b && byId.has(n.parent_b);
      return !hasA && !hasB;
    })
    .sort((a, b) => a.born_at_tick - b.born_at_tick || a.name.localeCompare(b.name, "ru"));

  const positions = new Map<string, { x: number; y: number }>();
  const placed = new Set<string>();

  function placeSubtree(id: string, left: number, depth: number): number {
    if (placed.has(id)) return positions.get(id)!.x;
    const kids = (children.get(id) ?? []).filter((c) => byId.has(c));
    const y = PAD + depth * (NODE_H + V_GAP);
    if (kids.length === 0) {
      const x = left + NODE_W / 2;
      positions.set(id, { x, y });
      placed.add(id);
      return x;
    }
    let cursor = left;
    const childXs: number[] = [];
    for (let i = 0; i < kids.length; i++) {
      const kid = kids[i]!;
      const w = subtreeWidth(kid, children, widthMemo);
      const cx = placeSubtree(kid, cursor, depth + 1);
      childXs.push(cx);
      cursor += w + H_GAP;
    }
    const x = (Math.min(...childXs) + Math.max(...childXs)) / 2;
    positions.set(id, { x, y });
    placed.add(id);
    return x;
  }

  // Корни с потомками — слева направо; одиночные корни — компактной сеткой справа/ниже.
  const rooted = roots.filter((r) => (children.get(r.id) ?? []).some((c) => byId.has(c)));
  const lone = roots.filter((r) => !(children.get(r.id) ?? []).some((c) => byId.has(c)));

  let cursorX = PAD;
  for (const r of rooted) {
    const w = subtreeWidth(r.id, children, widthMemo);
    placeSubtree(r.id, cursorX, depths.get(r.id) ?? 0);
    cursorX += w + H_GAP * 2;
  }

  // Одиночные корни — рядами.
  const loneCols = Math.max(4, Math.ceil(Math.sqrt(Math.max(1, lone.length))));
  const loneStartX = cursorX;
  const loneBaseY = PAD;
  lone.forEach((r, i) => {
    const col = i % loneCols;
    const row = Math.floor(i / loneCols);
    positions.set(r.id, {
      x: loneStartX + col * (NODE_W + H_GAP) + NODE_W / 2,
      y: loneBaseY + row * (NODE_H + V_GAP * 0.55),
    });
    placed.add(r.id);
  });

  // Узлы, не размещённые как потомки rooted (например, осиротевшие ветки) —
  // разместить по глубине слева от уже занятого.
  const maxDepth = Math.max(0, ...[...depths.values()]);
  for (const n of group) {
    if (placed.has(n.id)) continue;
    const d = depths.get(n.id) ?? 0;
    const rowPeers = group.filter((x) => !placed.has(x.id) && (depths.get(x.id) ?? 0) === d);
    rowPeers.forEach((peer, i) => {
      if (placed.has(peer.id)) return;
      positions.set(peer.id, {
        x: PAD + i * (NODE_W + H_GAP) + NODE_W / 2,
        y: PAD + d * (NODE_H + V_GAP),
      });
      placed.add(peer.id);
    });
  }

  // Нормализация: сдвиг к PAD.
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = 0;
  for (const p of positions.values()) {
    minX = Math.min(minX, p.x - NODE_W / 2);
    maxX = Math.max(maxX, p.x + NODE_W / 2);
    maxY = Math.max(maxY, p.y + NODE_H);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = NODE_W;
  }
  const shiftX = PAD - minX;
  const laid: LaidOutNode[] = [];
  for (const n of group) {
    const p = positions.get(n.id);
    if (!p) continue;
    laid.push({ id: n.id, x: p.x + shiftX, y: p.y, node: n });
  }

  const posById = new Map(laid.map((n) => [n.id, n]));
  const edges: LaidOutEdge[] = [];
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
      });
    }
  }

  const width = Math.max(PAD * 2 + (maxX - minX), PAD * 2 + loneCols * (NODE_W + H_GAP));
  const height = Math.max(PAD * 2 + maxY, PAD * 2 + (maxDepth + 1) * (NODE_H + V_GAP));

  return {
    species,
    label: SPECIES_LABEL[species],
    width,
    height,
    nodes: laid,
    edges,
  };
}

function layoutForest(nodes: GenealogyNode[]): { sections: SpeciesLayout[]; width: number; height: number } {
  const penguin = layoutSpecies(nodes, "penguin");
  const orca = layoutSpecies(nodes, "orca");
  const sections = [penguin, orca].filter((s): s is SpeciesLayout => !!s);

  let yOff = 0;
  let width = 400;
  const shifted: SpeciesLayout[] = [];
  for (const s of sections) {
    shifted.push({
      ...s,
      nodes: s.nodes.map((n) => ({ ...n, y: n.y + yOff + 36 })),
      edges: s.edges.map((e) => ({ ...e, y1: e.y1 + yOff + 36, y2: e.y2 + yOff + 36 })),
      // label sits above
    });
    width = Math.max(width, s.width);
    yOff += s.height + SECTION_GAP + 36;
  }
  return { sections: shifted, width, height: Math.max(yOff, 320) };
}

export function GenealogyForest({ onSelectCreature, active = true }: Props) {
  const [nodes, setNodes] = useState<GenealogyNode[] | null>(null);

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
    const id = window.setInterval(load, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [active]);

  const forest = useMemo(() => (nodes ? layoutForest(nodes) : null), [nodes]);

  if (!active) return null;
  if (!nodes) {
    return <div className="genealogy-forest genealogy-forest--loading">Загрузка древа…</div>;
  }
  if (nodes.length === 0 || !forest || forest.sections.length === 0) {
    return <div className="genealogy-forest genealogy-forest--empty">Пока нет существ для древа</div>;
  }

  return (
    <div className="genealogy-forest">
      <PanZoom width={forest.width} height={forest.height}>
        <div style={{ position: "relative", width: forest.width, height: forest.height }}>
          {forest.sections.map((section) => {
            const labelY = Math.min(...section.nodes.map((n) => n.y)) - 28;
            return (
              <div key={section.species}>
                <div
                  className="genealogy-forest__section-label"
                  style={{ position: "absolute", left: PAD, top: labelY, pointerEvents: "none" }}
                >
                  {section.label}
                </div>
                <svg
                  width={forest.width}
                  height={forest.height}
                  style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
                  aria-hidden
                >
                  {section.edges.map((e) => (
                    <path
                      key={e.key}
                      d={`M ${e.x1} ${e.y1} C ${e.x1} ${(e.y1 + e.y2) / 2}, ${e.x2} ${(e.y1 + e.y2) / 2}, ${e.x2} ${e.y2}`}
                      fill="none"
                      stroke="var(--border-strong, var(--border-subtle))"
                      strokeWidth={1.5}
                      opacity={0.7}
                    />
                  ))}
                </svg>
                {section.nodes.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    className={`genealogy-forest__node genealogy-forest__node--${n.node.species}${n.node.alive ? "" : " genealogy-forest__node--dead"}`}
                    style={{
                      position: "absolute",
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
                      {!n.node.alive ? " · †" : ""}
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </PanZoom>
    </div>
  );
}
