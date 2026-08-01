export function Timeline({ events = [] }: { events?: Array<{ when: string; text: string }> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", fontFamily: "var(--font-sans)" }}>
      {events.map((ev, i) => (
        <div key={i} style={{ display: "flex", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent-primary)", marginTop: 5 }} />
            {i < events.length - 1 && (
              <div style={{ width: 1, flex: 1, background: "var(--border-subtle)", minHeight: 24 }} />
            )}
          </div>
          <div style={{ paddingBottom: 18 }}>
            <div style={{ fontSize: 12, color: "var(--fg-tertiary)" }}>{ev.when}</div>
            <div style={{ fontSize: 14, color: "var(--fg-primary)" }}>{ev.text}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
