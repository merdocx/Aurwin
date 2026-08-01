export function Tabs({
  items,
  value,
  onChange,
}: {
  items: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div
      className="ds-tabs"
      style={{
        display: "flex",
        gap: 4,
        borderBottom: "1px solid var(--border-subtle)",
        fontFamily: "var(--font-sans)",
      }}
    >
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          onClick={() => onChange(it.value)}
          style={{
            border: "none",
            background: "none",
            cursor: "pointer",
            padding: "10px 14px",
            fontSize: 14,
            fontWeight: 600,
            fontFamily: "var(--font-sans)",
            color: value === it.value ? "var(--accent-primary)" : "var(--fg-tertiary)",
            borderBottom: `2px solid ${value === it.value ? "var(--accent-primary)" : "transparent"}`,
            marginBottom: -1,
            transition: "color var(--duration-fast)",
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
