export function TraitBar({ label, value = 0 }: { label: string; value?: number }) {
  const pct = ((value + 1) / 2) * 100;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, fontFamily: "var(--font-sans)", width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--fg-secondary)" }}>
        <span>{label}</span>
        <span>{value.toFixed(2)}</span>
      </div>
      <div style={{ position: "relative", height: 6, borderRadius: "var(--radius-pill)", background: "var(--bg-sunken)" }}>
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--border-default)" }} />
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            borderRadius: "var(--radius-pill)",
            background: "var(--accent-secondary)",
            left: value >= 0 ? "50%" : `${pct}%`,
            width: `${Math.abs(pct - 50)}%`,
            transition: "all var(--duration-slow) var(--ease-standard)",
          }}
        />
      </div>
    </div>
  );
}
