export function NeedBar({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "teal" | "amber" | "coral" | "violet";
}) {
  const resolved = tone ?? (value > 0.7 ? "coral" : value > 0.4 ? "amber" : "teal");
  const color =
    {
      teal: "var(--accent-primary)",
      amber: "var(--accent-warm)",
      coral: "var(--accent-danger)",
      violet: "var(--accent-secondary)",
    }[resolved];
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, fontFamily: "var(--font-sans)", width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--fg-secondary)" }}>
        <span>{label}</span>
        <span>{Math.round(pct)}%</span>
      </div>
      <div style={{ height: 6, borderRadius: "var(--radius-pill)", background: "var(--bg-sunken)", overflow: "hidden" }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: color,
            transition: "width var(--duration-slow) var(--ease-standard)",
          }}
        />
      </div>
    </div>
  );
}
