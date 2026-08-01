import type { ReactNode } from "react";

const TONES = {
  neutral: { bg: "var(--bg-sunken)", fg: "var(--fg-secondary)" },
  teal: { bg: "color-mix(in srgb, var(--accent-primary) 18%, transparent)", fg: "var(--accent-primary-hover)" },
  amber: { bg: "color-mix(in srgb, var(--accent-warm) 22%, transparent)", fg: "var(--amber-600)" },
  coral: { bg: "color-mix(in srgb, var(--accent-danger) 18%, transparent)", fg: "var(--coral-600)" },
  violet: { bg: "color-mix(in srgb, var(--accent-secondary) 18%, transparent)", fg: "var(--aurora-violet-600)" },
} as const;

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof TONES;
  children: ReactNode;
}) {
  const t = TONES[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontFamily: "var(--font-sans)",
        fontSize: 12,
        fontWeight: 600,
        padding: "3px 10px",
        borderRadius: "var(--radius-pill)",
        background: t.bg,
        color: t.fg,
        lineHeight: 1.4,
      }}
    >
      {children}
    </span>
  );
}
