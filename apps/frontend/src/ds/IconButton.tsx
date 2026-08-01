import type { ReactNode } from "react";
import { useState } from "react";

export function IconButton({
  label,
  active,
  onClick,
  children,
  size = 44,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  size?: number;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: size,
        height: size,
        borderRadius: "var(--radius-m)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: active ? "1px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
        background: active || hover ? "var(--bg-sunken)" : "var(--bg-surface)",
        color: active ? "var(--accent-primary)" : "var(--fg-secondary)",
        cursor: "pointer",
        transition: "background var(--duration-fast) var(--ease-standard)",
      }}
    >
      {children}
    </button>
  );
}

export function SunIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
      <path d="M21 14.3A8.5 8.5 0 0 1 9.7 3 7 7 0 1 0 21 14.3z" />
    </svg>
  );
}
