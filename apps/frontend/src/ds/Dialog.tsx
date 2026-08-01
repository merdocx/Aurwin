import type { ReactNode } from "react";

export function Dialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="ds-dialog-scrim"
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--overlay-scrim)",
        backdropFilter: "blur(var(--blur-scrim))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        animation: "aur-fade-in var(--duration-base) var(--ease-out)",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className="ds-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-surface)",
          borderRadius: "var(--radius-l)",
          border: "1px solid var(--border-subtle)",
          boxShadow: "var(--shadow-l)",
          padding: "var(--space-6)",
          minWidth: 320,
          maxWidth: 440,
          maxHeight: "min(88vh, 720px)",
          overflowY: "auto",
          fontFamily: "var(--font-sans)",
          animation: "aur-rise var(--duration-base) var(--ease-out)",
          width: "100%",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--fg-primary)", margin: 0 }}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18, color: "var(--fg-tertiary)" }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
