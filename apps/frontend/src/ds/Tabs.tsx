import type { KeyboardEvent } from "react";

export function Tabs({
  items,
  value,
  onChange,
}: {
  items: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const idx = items.findIndex((it) => it.value === value);
    if (idx < 0) return;
    let next = idx;
    if (e.key === "ArrowRight") next = (idx + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    onChange(items[next].value);
  }

  return (
    <div
      className="ds-tabs"
      role="tablist"
      onKeyDown={onKeyDown}
      style={{
        display: "flex",
        gap: 4,
        borderBottom: "1px solid var(--border-subtle)",
        fontFamily: "var(--font-sans)",
      }}
    >
      {items.map((it) => {
        const selected = value === it.value;
        return (
          <button
            key={it.value}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(it.value)}
            style={{
              border: "none",
              background: "none",
              cursor: "pointer",
              padding: "10px 14px",
              fontSize: 14,
              fontWeight: 600,
              fontFamily: "var(--font-sans)",
              color: selected ? "var(--accent-primary)" : "var(--fg-tertiary)",
              borderBottom: `2px solid ${selected ? "var(--accent-primary)" : "transparent"}`,
              marginBottom: -1,
              transition: "color var(--duration-fast)",
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
