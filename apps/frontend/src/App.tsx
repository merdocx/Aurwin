import { useState } from "react";
import { PixiWorld } from "./render/PixiWorld";
import { useWorldSocket } from "./ws/useWorldSocket";
import { CreatureCard } from "./components/CreatureCard";
import { SocialGraph } from "./components/SocialGraph";

const EMOTION_LEGEND = [
  { cls: "calm", label: "Спокоен" },
  { cls: "playful", label: "Игрив" },
  { cls: "afraid", label: "Напуган" },
  { cls: "grieving", label: "Скорбит" },
] as const;

export function App() {
  const { store, status, tick, phase, errorMessage, setViewport } = useWorldSocket();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSocialGraph, setShowSocialGraph] = useState(false);

  return (
    <main className="app" data-theme={phase === "night" ? "night" : "day"}>
      <PixiWorld store={store} onSelectCreature={setSelectedId} onViewportChange={setViewport} />

      <header className="hud">
        <span className="hud__brand">Aurwin</span>
        <span className={`hud__phase hud__phase--${phase}`}>{phase === "night" ? "ночь" : "день"}</span>
        <span className="hud__tick">тик {tick}</span>
        <span className={`hud__status hud__status--${status}`}>
          {status === "open"
            ? "на связи"
            : status === "connecting"
              ? "подключение…"
              : status === "rejected"
                ? "отказано"
                : "переподключение…"}
        </span>
        <button className="hud__button" type="button" onClick={() => setShowSocialGraph((v) => !v)}>
          {showSocialGraph ? "скрыть соцкарту" : "кто с кем дружит"}
        </button>
      </header>

      {errorMessage && <div className="hud__error">{errorMessage}</div>}

      {!showSocialGraph && (
        <div className="emotion-legend" aria-label="легенда эмоций">
          {EMOTION_LEGEND.map((row) => (
            <div key={row.cls} className="emotion-legend__row">
              <span className={`emotion-dot emotion-dot--${row.cls}`} />
              {row.label}
            </div>
          ))}
        </div>
      )}

      {selectedId && <CreatureCard creatureId={selectedId} onClose={() => setSelectedId(null)} />}
      {showSocialGraph && (
        <SocialGraph
          onClose={() => setShowSocialGraph(false)}
          onSelectCreature={(id) => {
            setSelectedId(id);
          }}
        />
      )}

      <footer className="hud-hint">
        Перетаскивайте карту мышью, крутите колесо для приближения, кликните по существу для карточки.
      </footer>
    </main>
  );
}
