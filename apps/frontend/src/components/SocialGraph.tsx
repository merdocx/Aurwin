import { useEffect, useMemo, useState } from "react";
import { fetchSocialGraph, type SocialGraph as SocialGraphDto } from "../api/client";

interface Props {
  onClose: () => void;
  onSelectCreature: (id: string) => void;
}

/** Раскладка узлов по кругу — простая и детерминированная, без силовой симуляции. */
function circularLayout(ids: string[], radius: number): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  ids.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / Math.max(1, ids.length);
    positions.set(id, { x: radius + radius * Math.cos(angle), y: radius + radius * Math.sin(angle) });
  });
  return positions;
}

export function SocialGraph({ onClose, onSelectCreature }: Props) {
  const [graph, setGraph] = useState<SocialGraphDto | null>(null);

  useEffect(() => {
    fetchSocialGraph().then(setGraph).catch(() => setGraph({ nodes: [], edges: [] }));
  }, []);

  const radius = 260;
  const size = radius * 2 + 40;
  const positions = useMemo(() => circularLayout((graph?.nodes ?? []).map((n) => n.id), radius), [graph]);

  return (
    <aside className="social-graph">
      <button className="creature-card__close" onClick={onClose} aria-label="закрыть" type="button">
        ×
      </button>
      <h2>Кто с кем дружит</h2>
      <p>Граф дружб текущей популяции — линия соединяет пары со сформировавшейся дружбой.</p>
      {!graph && <p>Загрузка…</p>}
      {graph && (
        <svg viewBox={`0 0 ${size} ${size}`} width="100%" height={size} role="img" aria-label="граф дружб">
          {graph.edges.map((edge) => {
            const a = positions.get(edge.a);
            const b = positions.get(edge.b);
            if (!a || !b) return null;
            return (
              <line
                key={`${edge.a}-${edge.b}`}
                className="social-graph__edge"
                x1={a.x + 20}
                y1={a.y + 20}
                x2={b.x + 20}
                y2={b.y + 20}
                strokeOpacity={0.25 + edge.strength * 0.55}
                strokeWidth={1 + edge.strength * 2}
              />
            );
          })}
          {graph.nodes.map((node) => {
            const p = positions.get(node.id);
            if (!p) return null;
            return (
              <g key={node.id} transform={`translate(${p.x + 20}, ${p.y + 20})`} onClick={() => onSelectCreature(node.id)} style={{ cursor: "pointer" }}>
                <circle
                  r={6}
                  className={node.species === "orca" ? "social-graph__node-orca" : "social-graph__node-penguin"}
                  strokeWidth={1.5}
                />
                <text className="social-graph__label" x={9} y={4} fontSize={10}>
                  {node.name}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      {graph && graph.nodes.length === 0 && <p>Пока никого нет.</p>}
    </aside>
  );
}
