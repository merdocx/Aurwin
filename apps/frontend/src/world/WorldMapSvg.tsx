/**
 * Статичный SVG-фон карты (порт /tmp/aurwin-ds/ui_kits/observatory/WorldScene.jsx):
 * градиенты моря/льда, текстура воды, континенты, айсберги, снежная крошка, блики.
 * Компонент не принимает динамических пропсов — тема переключается через
 * CSS-переменные (data-theme на предке .observatory).
 */
import {
  MAIN_LAND,
  FAR_ICE,
  THIRD_LAND,
  MEDIUM_SEEDS,
  SMALL_BERGS,
  SPARKLES,
  ICE_SPARKLES,
  MAP_W,
  MAP_H,
  type IslandSeed,
} from "./continents";

function seq<T>(n: number, fn: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => fn(i));
}

function Sparkle({ x, y, s = 6, color = "var(--neutral-0)", o = 0.85 }: { x: number; y: number; s?: number; color?: string; o?: number }) {
  const d =
    `M${x},${y - s} L${x + s * 0.28},${y - s * 0.28} L${x + s},${y} L${x + s * 0.28},${y + s * 0.28} ` +
    `L${x},${y + s} L${x - s * 0.28},${y + s * 0.28} L${x - s},${y} L${x - s * 0.28},${y - s * 0.28} Z`;
  return <path d={d} style={{ fill: color, opacity: o }} />;
}

/** Кольцо на постоянном смещении от береговой линии — имитация мелководья вокруг острова. */
function ringPath(land: typeof MAIN_LAND, off: number, step: number): string {
  let d = "";
  for (let a = 0; a <= Math.PI * 2 + 0.001; a += step) {
    const r = land.radiusAt(a) + off;
    const x = land.cx + Math.cos(a) * r;
    const y = land.cy + Math.sin(a) * r;
    d += (a === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1) + " ";
  }
  return d + "Z";
}

function archPath(s: IslandSeed, wob: (a: number) => number): string {
  // Круг ≈ hit-тест isLandMap (r * 1.15); лёгкий wobble без Y-squash.
  const pts = seq(24, (i) => {
    const a = (i / 24) * Math.PI * 2;
    const r = s.r * 1.15 * (1 + wob(a));
    return `${s.cx + Math.cos(a) * r},${s.cy + Math.sin(a) * r}`;
  });
  return "M" + pts.join(" L") + " Z";
}

export function WorldMapSvg() {
  return (
    <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} width={MAP_W} height={MAP_H} style={{ position: "absolute", inset: 0, display: "block" }}>
      <defs>
        <radialGradient id="sunGlow" cx="20%" cy="12%" r="60%">
          <stop offset="0%" style={{ stopColor: "var(--amber-400)", stopOpacity: 0.32 }} />
          <stop offset="100%" style={{ stopColor: "var(--amber-400)", stopOpacity: 0 }} />
        </radialGradient>
        <linearGradient id="seaGrad" x1="0" y1="0" x2="1" y2="0.5">
          <stop offset="0%" style={{ stopColor: "var(--navy-700)", stopOpacity: 1 }} />
          <stop offset="55%" style={{ stopColor: "var(--aurora-teal-600)", stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: "var(--aurora-teal-500)", stopOpacity: 1 }} />
        </linearGradient>
        <radialGradient id="iceGlow" cx="34%" cy="30%" r="78%">
          <stop offset="0%" style={{ stopColor: "var(--neutral-0)", stopOpacity: 1 }} />
          <stop offset="65%" style={{ stopColor: "var(--ice-100)", stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: "var(--ice-300)", stopOpacity: 1 }} />
        </radialGradient>
        <linearGradient id="rockGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" style={{ stopColor: "color-mix(in oklch, var(--amber-500) 28%, var(--navy-600) 72%)", stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: "var(--navy-700)", stopOpacity: 1 }} />
        </linearGradient>
        <filter id="coastShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx={0} dy={6} stdDeviation={8} floodColor="hsl(var(--shadow-color))" floodOpacity={0.3} />
        </filter>
        <pattern id="waterTexture" width={140} height={70} patternUnits="userSpaceOnUse" patternTransform="rotate(6)">
          <path d="M0,35 Q35,15 70,35 T140,35" stroke="var(--ice-100)" strokeWidth={2} fill="none" opacity={0.16}>
            <animate
              attributeName="d"
              dur="9s"
              repeatCount="indefinite"
              values="M0,35 Q35,15 70,35 T140,35;M0,35 Q35,55 70,35 T140,35;M0,35 Q35,15 70,35 T140,35"
            />
          </path>
        </pattern>
        <pattern id="snowGrain" width={26} height={26} patternUnits="userSpaceOnUse">
          {seq(5, (i) => (
            <circle key={i} cx={3 + (i * 5) % 24} cy={4 + (i * 9) % 22} r={0.9} fill="var(--ice-400)" opacity={0.5} />
          ))}
        </pattern>
        <clipPath id="landClip">
          <path d={MAIN_LAND.pathD()} />
        </clipPath>
        <clipPath id="floeClip">
          <path d={FAR_ICE.pathD(48)} />
        </clipPath>
        <clipPath id="thirdClip">
          <path d={THIRD_LAND.pathD()} />
        </clipPath>
      </defs>

      <rect x={0} y={0} width={MAP_W} height={MAP_H} fill="url(#seaGrad)" />
      <rect x={0} y={0} width={MAP_W} height={MAP_H} fill="url(#waterTexture)" />
      <rect x={0} y={0} width={MAP_W} height={MAP_H} fill="url(#sunGlow)" />

      {[70, 160, 280].map((off, i) => (
        <path key={"depth" + i} d={ringPath(MAIN_LAND, off, 0.15)} style={{ fill: "var(--ice-300)", opacity: 0.16 - i * 0.045 }} />
      ))}
      {[60, 140, 240].map((off, i) => (
        <path key={"fdepth" + i} d={ringPath(FAR_ICE, off, 0.18)} style={{ fill: "var(--ice-300)", opacity: 0.15 - i * 0.04 }} />
      ))}
      {[60, 140, 240].map((off, i) => (
        <path key={"tdepth" + i} d={ringPath(THIRD_LAND, off, 0.18)} style={{ fill: "var(--ice-300)", opacity: 0.15 - i * 0.04 }} />
      ))}

      {SPARKLES.map((s, i) => (
        <Sparkle key={"spw" + i} x={s.x} y={s.y} s={s.s} o={0.45} />
      ))}

      <path
        d="M0,0 L220,0 C244,44 202,82 148,69 C102,58 64,98 20,74 C0,62 0,27 0,0 Z"
        style={{ fill: "url(#rockGrad)" }}
        filter="url(#coastShadow)"
      />
      {seq(2, (i) => (
        <ellipse key={"rocksnow" + i} cx={40 + i * 85} cy={18 + i * 14} rx={28} ry={15} style={{ fill: "var(--neutral-0)", opacity: 0.5 }} />
      ))}

      {SMALL_BERGS.map((b, i) => (
        <g key={"sberg" + i}>
          <ellipse cx={b.x} cy={b.y + b.r * 0.5} rx={b.r * 1.2} ry={b.r * 0.35} style={{ fill: "var(--aurora-teal-500)", opacity: 0.22 }} />
          <ellipse cx={b.x} cy={b.y} rx={b.r} ry={b.r * 0.72} style={{ fill: "url(#iceGlow)", stroke: "var(--ice-400)", strokeWidth: 1.6 }} />
        </g>
      ))}

      {MEDIUM_SEEDS.map((s, i) => (
        <g key={"med" + i}>
          <path
            d={archPath(s, (a) => 0.12 * Math.sin(3 * a + i) + 0.08 * Math.sin(5 * a - i))}
            style={{ fill: "url(#iceGlow)", stroke: "var(--ice-400)", strokeWidth: 2.5, strokeLinejoin: "round" }}
          />
          <polygon
            points={`${s.cx - s.r * 0.2},${s.cy - s.r * 0.05} ${s.cx},${s.cy - s.r * 0.6} ${s.cx + s.r * 0.2},${s.cy - s.r * 0.05}`}
            style={{ fill: "var(--ice-300)", opacity: 0.7 }}
          />
        </g>
      ))}

      <path d={MAIN_LAND.pathD()} fill="url(#iceGlow)" stroke="var(--ice-400)" strokeWidth={4} strokeLinejoin="round" filter="url(#coastShadow)" />
      <path d={FAR_ICE.pathD(48)} fill="url(#iceGlow)" stroke="var(--ice-400)" strokeWidth={4} strokeLinejoin="round" filter="url(#coastShadow)" />
      <path d={THIRD_LAND.pathD()} fill="url(#iceGlow)" stroke="var(--ice-400)" strokeWidth={4} strokeLinejoin="round" filter="url(#coastShadow)" />

      <rect
        x={MAIN_LAND.cx - MAIN_LAND.baseR * 1.5}
        y={MAIN_LAND.cy - MAIN_LAND.baseR * 1.5}
        width={MAIN_LAND.baseR * 3}
        height={MAIN_LAND.baseR * 3}
        fill="url(#snowGrain)"
        clipPath="url(#landClip)"
        opacity={0.7}
      />
      <rect
        x={FAR_ICE.cx - FAR_ICE.baseR * 1.5}
        y={FAR_ICE.cy - FAR_ICE.baseR * 1.5}
        width={FAR_ICE.baseR * 3}
        height={FAR_ICE.baseR * 3}
        fill="url(#snowGrain)"
        clipPath="url(#floeClip)"
        opacity={0.7}
      />
      <rect
        x={THIRD_LAND.cx - THIRD_LAND.baseR * 1.5}
        y={THIRD_LAND.cy - THIRD_LAND.baseR * 1.5}
        width={THIRD_LAND.baseR * 3}
        height={THIRD_LAND.baseR * 3}
        fill="url(#snowGrain)"
        clipPath="url(#thirdClip)"
        opacity={0.7}
      />

      {ICE_SPARKLES.map((s, i) => (
        <Sparkle key={"spi" + i} x={s.x} y={s.y} s={s.s} color="var(--amber-400)" o={0.45} />
      ))}
    </svg>
  );
}
