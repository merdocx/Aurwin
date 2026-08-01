import type { TimedEvent } from "../ws/WorldStore";
import { eventInfo, eventLogLabel } from "./eventLabels";

export interface LogEntry {
  id: string;
  text: string;
  tone: string;
  actorId: string | null;
  targetId: string | null;
  zone: string | null;
}

interface Props {
  entries: LogEntry[];
  onSelect: (entry: LogEntry) => void;
}

/** Правая верхняя лента событий наблюдателя (порт дизайн-кита). */
export function EventLog({ entries, onSelect }: Props) {
  if (entries.length === 0) return null;
  return (
    <div
      className="observatory__event-log"
      style={{
        position: "absolute",
        right: 16,
        top: 16,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        width: 240,
        zIndex: 5,
        pointerEvents: "none",
      }}
      aria-label="лента событий"
    >
      {entries.map((e) => (
        <button
          key={e.id}
          type="button"
          onClick={() => onSelect(e)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-m)",
            padding: "6px 10px",
            boxShadow: "var(--shadow-s)",
            fontSize: 12,
            color: "var(--fg-secondary)",
            cursor: "pointer",
            textAlign: "left",
            fontFamily: "var(--font-sans)",
            pointerEvents: "auto",
            lineHeight: 1.35,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: e.tone,
              flex: "none",
            }}
          />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{e.text}</span>
        </button>
      ))}
    </div>
  );
}

const MAX_LOG = 6;

export function buildLogEntries(
  events: TimedEvent[],
  nameOf: (id: string) => string | undefined,
): LogEntry[] {
  const out: LogEntry[] = [];
  // Newest first; skip duplicates by id.
  const seen = new Set<string>();
  for (let i = events.length - 1; i >= 0 && out.length < MAX_LOG; i--) {
    const e = events[i]!;
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const label = eventLogLabel(e.type, e.payload);
    const info = eventInfo(e.type === "signal_sent" && typeof e.payload.signalType === "string" ? e.payload.signalType : e.type);
    const tone = info?.tone ?? "var(--fg-tertiary)";
    const actorName = e.actor_id ? nameOf(e.actor_id) : undefined;
    const text = actorName ? `${actorName} — ${label}` : label;
    out.push({
      id: e.id,
      text,
      tone,
      actorId: e.actor_id,
      targetId: e.target_id,
      zone: e.zone,
    });
  }
  return out;
}
