/**
 * Порт спрайтов существ Observatory (/tmp/aurwin-ds/ui_kits/observatory/WorldScene.jsx):
 * Penguin, Orca, HeadStatus, Creature, Fish. Чистые презентационные компоненты —
 * позиционирование, отбор данных живут в ObservatoryWorld.
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

function TinyMoonIcon({ size = 9, color = "var(--fg-tertiary)" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ marginLeft: 2, display: "inline-block" }}>
      <path d="M21 14.3A8.5 8.5 0 0 1 9.7 3 7 7 0 1 0 21 14.3z" fill={color} />
    </svg>
  );
}

function PenguinSimple({ swimming }: { swimming: boolean }) {
  if (swimming) {
    return (
      <svg viewBox="0 0 50 26" width={39} height={21} style={{ overflow: "visible" }}>
        <path d="M6,15 C4,9 10,4 20,4 C30,4 40,8 44,14 C40,19 30,21 20,21 C12,21 7,19 6,15 Z" fill="var(--navy-900)" />
      </svg>
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
  return (
    <svg viewBox="0 0 80 36" width={92} height={41} style={{ overflow: "visible" }}>
      <path
        d="M2,19 C3,9 14,3 27,3 C40,3 52,7 60,15 C63,17 63,20 60,22 C51,29 38,33 25,32 C13,31 4,27 2,19 Z"
        fill="var(--navy-900)"
      />
      {hunting && <ellipse cx={50} cy={18} rx={20} ry={7} style={{ fill: "var(--accent-danger)", opacity: 0.4 }} />}
    </svg>
  );
}

function Penguin({ state, swimming }: { state: CreatureState; swimming: boolean }) {
  const sleeping = state === "sleeping";
  const walking = state === "walking";
  if (swimming) {
    return (
      <svg viewBox="0 0 50 26" width={39} height={21} style={{ overflow: "visible" }}>
        <ellipse cx={8} cy={21} rx={10} ry={2.2} style={{ fill: "var(--ice-100)", opacity: 0.3 }} />
        <path d="M6,15 C4,9 10,4 20,4 C30,4 40,8 44,14 C40,19 30,21 20,21 C12,21 7,19 6,15 Z" fill="var(--navy-900)" />
        <path
          d="M9,16 C13,20 22,21 30,19 C35,17.5 39,15.5 42,13.5 C37,18 27,20.5 18,19.5 C13,19 10,17.5 9,16 Z"
          fill="var(--neutral-0)"
        />
        <g style={{ transformOrigin: "26px 9px", animation: "aur-fin-flutter 1s ease-in-out infinite" }}>
          <path d="M22,10 C29,6 37,6 42,9 C36,12 27,13 22,12 Z" fill="var(--navy-800)" />
        </g>
        <g style={{ transformOrigin: "42px 15px", animation: "aur-tail-swish 0.9s ease-in-out infinite" }}>
          <path d="M42,15 L49,11 L48,18.5 Z" fill="var(--navy-800)" />
        </g>
        <circle cx={12} cy={8.5} r={5.6} fill="var(--navy-900)" />
        <ellipse cx={14.4} cy={11.4} rx={2.3} ry={1.5} style={{ fill: "var(--coral-400)", opacity: 0.6 }} />
        {sleeping ? (
          <path d="M8.6,7.6 Q10.2,8.6 11.8,7.6" stroke="var(--navy-900)" strokeWidth={1} fill="none" />
        ) : (
          <>
            <ellipse cx={10.2} cy={7.4} rx={1.9} ry={2.1} fill="var(--neutral-0)" />
            <circle cx={9.9} cy={7.6} r={0.95} fill="var(--navy-900)" />
            <circle cx={10.5} cy={6.9} r={0.4} fill="var(--neutral-0)" />
          </>
        )}
        <path d="M6.5,9.2 L0.6,10.2 L6.5,11.6 Z" fill="var(--accent-warm)" />
        <ellipse cx={10} cy={5.8} rx={1.6} ry={1} style={{ fill: "var(--neutral-0)", opacity: 0.5 }} />
      </svg>
    );
  }
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

function Orca({ state }: { state: CreatureState }) {
  const sleeping = state === "sleeping";
  const hunting = state === "hunting";
  return (
    <svg viewBox="0 0 80 36" width={92} height={41} style={{ overflow: "visible", opacity: sleeping ? 0.85 : 1 }}>
      {hunting && (
        <ellipse cx={42} cy={20} rx={36} ry={10} style={{ fill: "var(--accent-danger)", opacity: 0.22 }} />
      )}
      <g
        style={{
          transformOrigin: "60px 18px",
          animation: hunting ? "aur-tail-swish 0.55s ease-in-out infinite" : "aur-tail-swish 1.1s ease-in-out infinite",
        }}
      >
        <path
          d="M60,18 C64,12 70,9 75,10 C71,14 66,17 62,19 C66,21 71,24 75,29 C70,30 64,26 60,20 Z"
          fill="var(--navy-900)"
        />
      </g>
      <path
        d="M2,19 C3,9 14,3 27,3 C40,3 52,7 60,15 C63,17 63,20 60,22 C51,29 38,33 25,32 C13,31 4,27 2,19 Z"
        fill="var(--navy-900)"
      />
      <path d="M8,21 C14,27 26,29 36,27 C44,25 50,22 54,18 C47,24 34,27 24,25 C16,23 10,22 8,21 Z" fill="var(--neutral-0)" />
      <path
        d="M27,4 C25,-6 29,-15 34,-16 C36,-15 34,-5 38,5 C34,3 30,3 27,4 Z"
        fill="var(--navy-900)"
      />
      <path d="M30,5 C36,4 42,6 44,10 C39,9 33,8 29,9 Z" style={{ fill: "var(--fg-tertiary)", opacity: 0.55 }} />
      <ellipse cx={14.5} cy={12} rx={5} ry={2.4} fill="var(--neutral-0)" transform="rotate(-18 14.5 12)" />
      {sleeping ? (
        <path d="M12.2,12.4 Q14.5,13.4 16.8,12.4" stroke="var(--navy-900)" strokeWidth={0.9} fill="none" />
      ) : (
        <>
          <circle cx={14.5} cy={12.6} r={1.5} fill="var(--navy-900)" />
          <circle cx={15} cy={12} r={0.5} fill="var(--neutral-0)" />
        </>
      )}
      {hunting && (
        <g style={{ transformOrigin: "6px 18px", animation: "aur-chomp 0.45s ease-in-out infinite" }}>
          <path d="M2,16 C5,14 8,15 10,18 C8,20 5,21 2,19 Z" fill="var(--navy-900)" />
        </g>
      )}
      <ellipse cx={11} cy={7} rx={3.4} ry={1.8} style={{ fill: "var(--neutral-0)", opacity: 0.4 }} />
    </svg>
  );
}

function HeadStatus({
  state,
  swimming,
  isOrca,
  noseLed,
  children,
}: {
  state: CreatureState;
  swimming: boolean;
  isOrca: boolean;
  noseLed: boolean;
  children: ReactNode;
}) {
  void state;
  // В воде якорь = нос: эмоция чуть сзади/выше носа в локальных координатах арта.
  const off = noseLed
    ? isOrca
      ? { top: 6, left: 18 }
      : { top: 4, left: 12 }
    : isOrca
      ? { top: -5, left: 52 }
      : swimming
        ? { top: -2, left: 9 }
        : { top: -8, left: 21 };
  return (
    <div style={{ position: "absolute", top: off.top, left: off.left, transform: "translate(-50%,-50%)", zIndex: 2 }}>
      {children}
    </div>
  );
}

/** Нос в пикселях спрайта (арт смотрит в −X). */
const NOSE_PX = {
  penguin: { x: (0.6 / 50) * 39, y: (10.2 / 26) * 21 },
  orca: { x: (2 / 80) * 92, y: (18 / 36) * 41 },
} as const;

function headingTransform(facingRad: number, nose: { x: number; y: number }): string {
  // Арт носом влево → +180°, чтобы нос смотрел по курсу движения.
  const deg = (facingRad * 180) / Math.PI + 180;
  return `rotate(${deg}deg) translate(${-nose.x}px, ${-nose.y}px)`;
}

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
  const inWaterVisual = swimming || transit || state === "foraging" || state === "fleeing" || state === "hunting";
  const noseLed = isOrca || inWaterVisual;
  const nose = isOrca ? NOSE_PX.orca : NOSE_PX.penguin;
  return (
    <button
      ref={(el) => registerEl?.(id, el)}
      onClick={() => onClick(id)}
      aria-label={name}
      data-creature-id={id}
      data-nose-led={noseLed ? "1" : "0"}
      data-nose-x={nose.x}
      data-nose-y={nose.y}
      style={{
        // Позиция только через el.style.transform в RAF.
        // Нельзя писать transform сюда: любой React re-render сбрасывал бы
        // существ в -9999/0 и давал «телепорт» через всю карту.
        position: "absolute",
        left: 0,
        top: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: 0,
        willChange: "transform",
      }}
    >
      {!lod && state === "fleeing" && (
        <div
          style={{
            position: "absolute",
            top: noseLed ? -14 : -10,
            left: "50%",
            transform: "translate(-50%,0)",
            fontSize: 9,
            fontFamily: "var(--font-mono)",
            color: "var(--accent-danger)",
            whiteSpace: "nowrap",
            opacity: 0.9,
            pointerEvents: "none",
            zIndex: 3,
          }}
        >
          бегство
        </div>
      )}
      <div
        data-facing
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
          transformOrigin: noseLed ? "0 0" : "50% 50%",
          transform: noseLed ? headingTransform(facing, nose) : faceRight ? undefined : "scaleX(-1)",
        }}
      >
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
            animation: lod ? "none" : animCss,
          }}
        >
        {!lod && (isOrca || inWaterVisual) && (
          <div
            style={{
              position: "absolute",
              top: "68%",
              width: isOrca ? (state === "hunting" ? 86 : 70) : 22,
              height: isOrca ? 20 : 8,
              borderRadius: "50%",
              background: state === "hunting" ? "var(--accent-danger)" : "var(--ice-100)",
              opacity: state === "hunting" ? 0.28 : 0.35,
            }}
          />
        )}
        {!lod && transit && (
          <div
            style={{
              position: "absolute",
              top: "70%",
              width: 28,
              height: 14,
              borderRadius: "50%",
              border: "2px solid var(--ice-100)",
              opacity: 0.55,
              animation: "aur-splash-pop 0.9s ease-out",
            }}
          />
        )}
        {lod ? (
          isOrca ? <OrcaSimple hunting={state === "hunting"} /> : <PenguinSimple swimming={inWaterVisual} />
        ) : isOrca ? (
          <Orca state={orcaDrawState(state)} />
        ) : (
          <Penguin state={penguinDrawState(state)} swimming={inWaterVisual} />
        )}
        {!lod && (
          <HeadStatus state={penguinDrawState(state)} swimming={inWaterVisual} isOrca={isOrca} noseLed={noseLed}>
            <EmotionIndicator emotion={emotion} size={6} pulse={emotion === "afraid" || state === "fleeing"} />
          </HeadStatus>
        )}
        </div>
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
