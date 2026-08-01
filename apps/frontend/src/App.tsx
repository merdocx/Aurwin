import { useCallback, useEffect, useState } from "react";
import { ObservatoryWorld } from "./world/ObservatoryWorld";
import { useWorldClock, useWorldSocket } from "./ws/useWorldSocket";
import { CreatureCardPanel } from "./components/CreatureCard";
import { SocialGraph } from "./components/SocialGraph";
import { fetchWorldStats, type WorldStats } from "./api/client";
import { Tabs } from "./ds/Tabs";
import { Dialog } from "./ds/Dialog";
import { EmotionIndicator, type EmotionKind } from "./ds/EmotionIndicator";
import { IconButton, MoonIcon, SunIcon } from "./ds/IconButton";
import { formatWorldAge } from "./world/worldAge";

const EMOTION_LEGEND: Array<{ emotion: EmotionKind; label: string }> = [
  { emotion: "calm", label: "Спокоен" },
  { emotion: "playful", label: "Игрив" },
  { emotion: "afraid", label: "Напуган" },
  { emotion: "grieving", label: "Скорбит" },
];

const HINT_KEY = "aurwin-observatory-hint-dismissed";

export function App() {
  const { store, status, errorMessage, setViewport } = useWorldSocket();
  const { tick, phase } = useWorldClock(store);
  const [tab, setTab] = useState<"world" | "social">("world");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState("");
  const [stats, setStats] = useState<WorldStats | null>(null);
  const [hintVisible, setHintVisible] = useState(() => {
    try {
      return !localStorage.getItem(HINT_KEY);
    } catch {
      return true;
    }
  });

  useEffect(() => {
    let cancelled = false;
    function load() {
      fetchWorldStats()
        .then((s) => !cancelled && setStats(s))
        .catch(() => undefined);
    }
    load();
    const id = window.setInterval(load, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  function dismissHint() {
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      /* ignore */
    }
    setHintVisible(false);
  }

  const penguins = stats?.population.penguin ?? "—";
  const orcas = stats?.population.orca ?? "—";
  const phaseHint = phase === "day" ? "Светлая половина суток — колония кормится" : "Большая часть колонии спит";
  const ageLabel = formatWorldAge(tick, store.tickSeconds);

  const onSelectCreature = useCallback(
    (id: string) => {
      setSelectedId(id);
      setSelectedName(store.creatureName(id) ?? "");
    },
    [store],
  );

  return (
    <div className="observatory" data-theme={phase === "night" ? "night" : "day"}>
      <header className="observatory__header">
        <div className="observatory__header-left">
          <span className="observatory__brand">Aurwin</span>
          <Tabs
            value={tab}
            onChange={(v) => setTab(v as "world" | "social")}
            items={[
              { value: "world", label: "Мир" },
              { value: "social", label: "Кто с кем дружит" },
            ]}
          />
        </div>
        <div className="observatory__header-right">
          <div className="observatory__meta">
            <span>
              {ageLabel} · {penguins} пингвинов · {orcas} касаток
            </span>
            <span className="observatory__meta-hint">
              {status === "open" ? phaseHint : status === "connecting" ? "подключение к миру…" : "связь восстанавливается…"}
            </span>
          </div>
          <IconButton label={phase === "night" ? "Сейчас ночь" : "Сейчас день"} active>
            {phase === "night" ? <MoonIcon /> : <SunIcon />}
          </IconButton>
        </div>
      </header>

      <main className="observatory__main">
        {tab === "world" ? (
          <>
            <ObservatoryWorld
              store={store}
              onSelectCreature={onSelectCreature}
              onViewportChange={setViewport}
              focusCreatureId={selectedId}
            />
            <div className="observatory__legend" aria-label="легенда эмоций">
              {EMOTION_LEGEND.map((row) => (
                <div key={row.emotion} className="observatory__legend-row">
                  <EmotionIndicator emotion={row.emotion} size={8} />
                  {row.label}
                </div>
              ))}
            </div>
            {hintVisible && (
              <div className="observatory__hint">
                Перетащите карту и кликните на существо, чтобы узнать о нём больше
                <button type="button" onClick={dismissHint} aria-label="Закрыть подсказку" className="observatory__hint-close">
                  ×
                </button>
              </div>
            )}
          </>
        ) : (
          <SocialGraph onSelectCreature={onSelectCreature} active={tab === "social"} />
        )}
      </main>

      {errorMessage && <div className="observatory__error">{errorMessage}</div>}

      <Dialog
        open={!!selectedId}
        title={selectedName || "Существо"}
        onClose={() => {
          setSelectedId(null);
          setSelectedName("");
        }}
      >
        {selectedId && (
          <CreatureCardPanel
            creatureId={selectedId}
            onName={(name) => setSelectedName(name)}
          />
        )}
      </Dialog>
    </div>
  );
}
