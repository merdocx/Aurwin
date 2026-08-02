/**
 * Спрайты Observatory: наземный пингвин upright; в воде — top-down
 * под body_radius × MAP/SIM. Позиция/facing — в ObservatoryWorld (RAF).
 */
import { memo, type CSSProperties, type ReactNode } from "react";
import { EmotionIndicator, type EmotionKind } from "../ds/EmotionIndicator";
import type { FishSeed } from "./continents";

export type Species = "penguin" | "orca";
export type CreatureState =
  | "idle"
  | "walking"
  | "swimming"
  | "sleeping"
  | "hunting"
  | "fleeing"
  | "entering_water"
  | "exiting_water"
  | "foraging";

const STATE_ANIM: Record<CreatureState, string | null> = {
  walking: "aur-waddle",
  swimming: "aur-swim-cycle",
  hunting: "aur-hunt-lunge",
  fleeing: "aur-flee-dash",
  sleeping: "aur-sleep-breathe",
  entering_water: "aur-jump-arc",
  exiting_water: "aur-jump-arc",
  foraging: "aur-swim-cycle",
  idle: null,
};

/** MAP_W/SIM_W — см. continents.ts. */
const MAP_PER_SIM = 1.6;
/** body_radius_units из constants.yaml → радиус hit/ширина на карте. */
const HIT_R = {
  penguin: 10 * MAP_PER_SIM,
  orca: 28 * MAP_PER_SIM,
} as const;

/** Длина top-down арта (px); пропорции PNG (нос влево). */
const SPRITE = {
  // penguin.png 512×410 → ~1.25; компактнее, ближе к body diameter 32.
  penguin: { w: 32, h: 26 },
  // orca.png 512×263 → ~1.95; в пределах диаметра body_radius (~90px)
  orca: { w: 84, h: 43 },
} as const;

const WATER_ART = {
  penguin: {
    body: "/creatures/penguin-body.png",
    finN: "/creatures/penguin-fin-n.png",
    finS: "/creatures/penguin-fin-s.png",
    tail: "/creatures/penguin-tail.png",
    full: "/creatures/penguin.png",
    // Pivot в % от спрайта (нос влево).
    finOrigin: "42% 50%",
    tailOrigin: "86% 50%",
  },
  orca: {
    body: "/creatures/orca-body.png",
    finN: "/creatures/orca-fin-n.png",
    finS: "/creatures/orca-fin-s.png",
    tail: "/creatures/orca-tail.png",
    full: "/creatures/orca.png",
    finOrigin: "38% 50%",
    tailOrigin: "84% 50%",
  },
} as const;

function TinyMoonIcon({ size = 9, color = "var(--fg-tertiary)" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ marginLeft: 2, display: "inline-block" }}>
      <path d="M21 14.3A8.5 8.5 0 0 1 9.7 3 7 7 0 1 0 21 14.3z" fill={color} />
    </svg>
  );
}

/** LOD: top-down силуэт / уменьшенный PNG. */
function PenguinSimple({ swimming }: { swimming: boolean }) {
  if (swimming) {
    const { w, h } = SPRITE.penguin;
    return (
      <img
        src={WATER_ART.penguin.full}
        alt=""
        width={w}
        height={h}
        draggable={false}
        style={{ display: "block", objectFit: "contain", pointerEvents: "none" }}
      />
    );
  }
  return (
    <svg viewBox="-14 0 46 40" width={27} height={31} style={{ overflow: "visible" }}>
      <path
        d="M16,9 C25,9 28.5,18 27.5,25.5 C26.5,32 21.5,36 16,36 C10.5,36 5.5,32 4.5,25.5 C3.5,18 7,9 16,9 Z"
        fill="var(--navy-900)"
      />
    </svg>
  );
}

function OrcaSimple({ hunting = false }: { hunting?: boolean }) {
  const { w, h } = SPRITE.orca;
  return (
    <div style={{ position: "relative", width: w, height: h }}>
      <img
        src={WATER_ART.orca.full}
        alt=""
        width={w}
        height={h}
        draggable={false}
        style={{ display: "block", objectFit: "contain", pointerEvents: "none", opacity: hunting ? 1 : 1 }}
      />
      {hunting && (
        <div
          style={{
            position: "absolute",
            inset: "18% 22%",
            borderRadius: "50%",
            background: "var(--accent-danger)",
            opacity: 0.28,
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}

type WaterKind = "penguin" | "orca";

/** PNG-слои: тело статично; плавники и хвост качаются. Нос влево. */
function WaterPhotoSprite({
  kind,
  sleeping,
  hunting = false,
}: {
  kind: WaterKind;
  sleeping: boolean;
  hunting?: boolean;
}) {
  const { w, h } = SPRITE[kind];
  const art = WATER_ART[kind];
  const finDur = hunting ? "0.7s" : kind === "orca" ? "1.15s" : "1.0s";
  const tailDur = hunting ? "0.5s" : kind === "orca" ? "0.95s" : "1.1s";
  const layer = (src: string, origin: string, anim: string | undefined): CSSProperties => ({
    position: "absolute",
    left: 0,
    top: 0,
    width: w,
    height: h,
    objectFit: "fill",
    pointerEvents: "none",
    transformOrigin: origin,
    animation: anim,
    willChange: anim ? "transform" : undefined,
  });
  return (
    <div
      style={{
        position: "relative",
        width: w,
        height: h,
        display: "block",
        overflow: "visible",
        opacity: sleeping ? 0.85 : 1,
      }}
    >
      {hunting && (
        <div
          style={{
            position: "absolute",
            inset: "12% 18%",
            borderRadius: "50%",
            background: "var(--accent-danger)",
            opacity: 0.2,
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
      )}
      <img src={art.body} alt="" draggable={false} style={{ ...layer(art.body, "50% 50%", undefined), position: "absolute", zIndex: 1 }} />
      <img
        src={art.finN}
        alt=""
        draggable={false}
        style={{ ...layer(art.finN, art.finOrigin, sleeping ? undefined : `aur-fin-paddle ${finDur} ease-in-out infinite`), zIndex: 2 }}
      />
      <img
        src={art.finS}
        alt=""
        draggable={false}
        style={{
          ...layer(art.finS, art.finOrigin, sleeping ? undefined : `aur-fin-paddle ${finDur} ease-in-out infinite reverse`),
          zIndex: 2,
        }}
      />
      <img
        src={art.tail}
        alt=""
        draggable={false}
        style={{
          ...layer(art.tail, art.tailOrigin, sleeping ? undefined : `aur-tail-swish ${tailDur} ease-in-out infinite`),
          zIndex: 2,
        }}
      />
    </div>
  );
}

/** Top-down пингвин в воде — загруженный PNG. */
function PenguinTopDown({ sleeping }: { sleeping: boolean }) {
  return <WaterPhotoSprite kind="penguin" sleeping={sleeping} />;
}

/** Top-down касатка — загруженный PNG. */
function OrcaTopDown({ sleeping, hunting }: { sleeping: boolean; hunting: boolean }) {
  return <WaterPhotoSprite kind="orca" sleeping={sleeping} hunting={hunting} />;
}

/** Наземный upright — без изменений. */
function PenguinLand({ state }: { state: CreatureState }) {
  const sleeping = state === "sleeping";
  const walking = state === "walking";
  const legStyle = (side: "l" | "r"): CSSProperties => ({
    transformOrigin: (side === "l" ? "13px" : "19px") + " 34px",
    animation: walking ? `aur-leg-step-${side} 1.3s ease-in-out infinite` : "none",
  });
  return (
    <svg viewBox="-14 0 46 40" width={27} height={31} style={{ overflow: "visible" }}>
      <g style={legStyle("l")}>
        <path d="M13,33 C11.5,33 10,34.4 9,36.6 C11,36.2 12.6,35.8 14,35.2 Z" fill="var(--accent-warm)" />
      </g>
      <g style={legStyle("r")}>
        <path d="M19,33 C20.5,33 22,34.4 23,36.6 C21,36.2 19.4,35.8 18,35.2 Z" fill="var(--accent-warm)" />
      </g>
      <path
        d="M16,9 C25,9 28.5,18 27.5,25.5 C26.5,32 21.5,36 16,36 C10.5,36 5.5,32 4.5,25.5 C3.5,18 7,9 16,9 Z"
        fill="var(--navy-900)"
      />
      <path
        d="M16,12.5 C20.5,12.5 22.5,19 22,25.5 C21.5,30.5 19,33.5 16,33.5 C13,33.5 10.5,30.5 10,25.5 C9.5,19 11.5,12.5 16,12.5 Z"
        fill="var(--neutral-0)"
      />
      <g style={{ transformOrigin: "5px 20px", animation: "aur-fin-flutter 2.2s ease-in-out infinite" }}>
        <path d="M5,19 C1,21 -1,26 -0.5,31 C2.5,28 5.5,24 6.5,20 Z" fill="var(--navy-800)" />
      </g>
      <g style={{ transformOrigin: "27px 20px", animation: "aur-fin-flutter 2.4s ease-in-out infinite reverse" }}>
        <path d="M27,19 C31,21 33,26 32.5,31 C29.5,28 26.5,24 25.5,20 Z" fill="var(--navy-800)" />
      </g>
      <g style={sleeping ? { transformOrigin: "16px 22px", transform: "translateY(9px)" } : undefined}>
        <circle cx={16} cy={7.5} r={6.8} fill="var(--navy-900)" />
        <ellipse cx={9.2} cy={10.6} rx={2.6} ry={1.8} style={{ fill: "var(--coral-400)", opacity: 0.6 }} />
        <ellipse cx={22.8} cy={10.6} rx={2.6} ry={1.8} style={{ fill: "var(--coral-400)", opacity: 0.6 }} />
        {sleeping ? (
          <>
            <path d="M11.6,6.2 Q13.2,7.2 14.8,6.2" stroke="var(--navy-900)" strokeWidth={1} fill="none" />
            <path d="M17.2,6.2 Q18.8,7.2 20.4,6.2" stroke="var(--navy-900)" strokeWidth={1} fill="none" />
          </>
        ) : (
          <>
            <ellipse cx={13.2} cy={6} rx={1.9} ry={2.2} fill="var(--neutral-0)" />
            <ellipse cx={18.8} cy={6} rx={1.9} ry={2.2} fill="var(--neutral-0)" />
            <circle cx={13.7} cy={5.7} r={0.9} fill="var(--navy-900)" />
            <circle cx={19.3} cy={5.7} r={0.9} fill="var(--navy-900)" />
            <circle cx={14.2} cy={5} r={0.4} fill="var(--neutral-0)" />
            <circle cx={19.8} cy={5} r={0.4} fill="var(--neutral-0)" />
          </>
        )}
        <path d="M13.2,8.6 Q16,11.8 18.8,8.6 Q16,7.4 13.2,8.6 Z" fill="var(--accent-warm)" />
        <ellipse cx={12.6} cy={4} rx={1.9} ry={1.1} style={{ fill: "var(--neutral-0)", opacity: 0.45 }} />
      </g>
    </svg>
  );
}

function Penguin({ state, swimming }: { state: CreatureState; swimming: boolean }) {
  if (swimming) return <PenguinTopDown sleeping={state === "sleeping"} />;
  return <PenguinLand state={state} />;
}

function Orca({ state }: { state: CreatureState }) {
  return <OrcaTopDown sleeping={state === "sleeping"} hunting={state === "hunting"} />;
}

function HeadStatus({
  isOrca,
  noseLed,
  children,
}: {
  isOrca: boolean;
  noseLed: boolean;
  children: ReactNode;
}) {
  // Только наземный пингвин: над головой внутри upright-спрайта.
  // Top-down (noseLed): статус снаружи facing — см. data-status + applyFacing.
  if (noseLed) return null;
  void isOrca;
  return (
    <div style={{ position: "absolute", top: -8, left: 21, transform: "translate(-50%,-50%)", zIndex: 2, pointerEvents: "none" }}>
      {children}
    </div>
  );
}

/**
 * Якорь арта (top-down: центр тела; land: центр upright).
 * Мир-точка сима = центр; клиренс shore = halfLength вокруг него.
 */
const BODY_CENTER = {
  penguin: { x: SPRITE.penguin.w * 0.5, y: SPRITE.penguin.h / 2 },
  orca: { x: SPRITE.orca.w * 0.42, y: SPRITE.orca.h / 2 },
} as const;

export interface CreatureViewProps {
  id: string;
  name: string;
  species: Species;
  /** Игнорируется RAF (позиция через translate3d); оставлено для совместимости. */
  x?: number;
  y?: number;
  emotion: EmotionKind;
  state: CreatureState;
  swimming: boolean;
  facing?: number;
  faceRight?: boolean;
  simplified?: boolean;
  onClick: (id: string) => void;
  registerEl?: (id: string, el: HTMLButtonElement | null) => void;
}

function penguinDrawState(state: CreatureState): CreatureState {
  if (state === "entering_water" || state === "exiting_water" || state === "foraging" || state === "fleeing") return "swimming";
  if (state === "hunting") return "swimming";
  return state;
}

function orcaDrawState(state: CreatureState): "sleeping" | "swimming" | "hunting" {
  if (state === "hunting") return "hunting";
  if (state === "sleeping") return "sleeping";
  return "swimming";
}

export const Creature = memo(function Creature({
  id,
  name,
  species,
  emotion,
  state,
  swimming,
  facing = 0,
  faceRight: faceRightProp,
  simplified,
  onClick,
  registerEl,
}: CreatureViewProps) {
  const isOrca = species === "orca";
  const animName = STATE_ANIM[state];
  const transit = state === "entering_water" || state === "exiting_water";
  const dur =
    state === "sleeping"
      ? 5
      : state === "walking"
        ? 2.6
        : transit
          ? 0.85
          : state === "hunting" || state === "fleeing"
            ? 1.15
            : state === "swimming" || state === "foraging"
              ? 3.4
              : 4 + (id.charCodeAt(0) % 3);
  const animCss = animName ? `${animName} ${dur}s var(--ease-drift) ${transit ? "1" : "infinite"}` : "none";
  const lod = simplified === true;
  const faceRight = faceRightProp ?? Math.cos(facing) >= -0.08;
  void faceRight;
  const inWaterVisual = swimming || transit || state === "foraging" || state === "fleeing" || state === "hunting";
  const noseLed = isOrca || inWaterVisual;
  const hitR = isOrca ? HIT_R.orca : HIT_R.penguin;
  const body = isOrca ? BODY_CENTER.orca : BODY_CENTER.penguin;
  const sprite = isOrca ? SPRITE.orca : SPRITE.penguin;
  // Land penguin: hit around upright sprite center.
  const landHit = { x: 13.5, y: 18, r: HIT_R.penguin };

  return (
    <button
      ref={(el) => registerEl?.(id, el)}
      onClick={() => onClick(id)}
      aria-label={name}
      data-creature-id={id}
      data-nose-led={noseLed ? "1" : "0"}
      data-anchor-x={noseLed ? body.x : landHit.x}
      data-anchor-y={noseLed ? body.y : landHit.y}
      data-status-lift={noseLed ? sprite.w / 2 + 8 : 0}
      style={{
        // Позиция только через el.style.transform в RAF.
        position: "absolute",
        left: 0,
        top: 0,
        display: "block",
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: 0,
        willChange: "transform",
        overflow: "visible",
        // Клик только через hit-disc (= body_radius), не через layout SVG.
        pointerEvents: "none",
      }}
    >
      {/* Jump снаружи facing — дуга всегда в экранный −Y. */}
      <div
        style={{
          position: "relative",
          animation: !lod && transit ? animCss : "none",
          pointerEvents: "none",
        }}
      >
        {!lod && transit && (
          <div
            style={{
              position: "absolute",
              left: noseLed ? body.x : landHit.x,
              top: (noseLed ? body.y : landHit.y) + 12,
              width: 28,
              height: 14,
              marginLeft: -14,
              marginTop: -7,
              borderRadius: "50%",
              border: "2px solid var(--ice-100)",
              opacity: 0.55,
              animation: "aur-splash-pop 0.9s ease-out",
              pointerEvents: "none",
              zIndex: 1,
            }}
          />
        )}
        <div
          data-facing
          style={{
            position: "relative",
            display: "block",
            pointerEvents: "none",
            // transform только императивно (ObservatoryWorld.applyFacing)
          }}
        >
          {/* Hit-disc = body_radius на карте; клик совпадает с separation/contact. */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: noseLed ? body.x : landHit.x,
              top: noseLed ? body.y : landHit.y,
              width: 2 * (noseLed ? hitR : landHit.r),
              height: 2 * (noseLed ? hitR : landHit.r),
              marginLeft: -(noseLed ? hitR : landHit.r),
              marginTop: -(noseLed ? hitR : landHit.r),
              borderRadius: "50%",
              pointerEvents: "auto",
              cursor: "pointer",
              zIndex: 1,
            }}
          />
          <div
            style={{
              position: "relative",
              display: "block",
              pointerEvents: "none",
              animation: !lod && !transit && animName ? animCss : "none",
            }}
          >
            {lod ? (
              isOrca ? (
                <OrcaSimple hunting={state === "hunting"} />
              ) : (
                <PenguinSimple swimming={inWaterVisual} />
              )
            ) : isOrca ? (
              <Orca state={orcaDrawState(state)} />
            ) : (
              <Penguin state={penguinDrawState(state)} swimming={inWaterVisual} />
            )}
            {!lod && !noseLed && (
              <HeadStatus isOrca={isOrca} noseLed={noseLed}>
                <EmotionIndicator emotion={emotion} size={6} pulse={emotion === "afraid" || state === "fleeing"} />
              </HeadStatus>
            )}
          </div>
        </div>
        {/* Статус снаружи facing: всегда экранно над телом, вне силуэта. */}
        {!lod && noseLed && (
          <div
            data-status
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              zIndex: 4,
              pointerEvents: "none",
              // transform — в ObservatoryWorld.applyFacing
            }}
          >
            <EmotionIndicator emotion={emotion} size={6} pulse={emotion === "afraid" || state === "fleeing"} />
          </div>
        )}
      </div>
    </button>
  );
});

export const Fish = memo(function Fish({ f, opacity = 1 }: { f: FishSeed; opacity?: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: f.x + "px",
        top: f.y + "px",
        transform: `translate(-50%,-50%) scaleX(${f.dir})`,
        pointerEvents: "none",
        opacity,
      }}
    >
      <div style={{ animation: `aur-fish-swim ${f.dur}s ease-in-out ${f.delay}s infinite` }}>
        <svg viewBox="0 0 20 10" width={15} height={8} style={{ overflow: "visible" }}>
          <path d="M2,5 C2,2 9,1 15,5 C9,9 2,8 2,5 Z" style={{ fill: "var(--ice-100)", opacity: 0.6 }} />
          <path d="M0,5 L4,2.6 L4,7.4 Z" style={{ fill: "var(--ice-100)", opacity: 0.6 }} />
        </svg>
      </div>
    </div>
  );
});
