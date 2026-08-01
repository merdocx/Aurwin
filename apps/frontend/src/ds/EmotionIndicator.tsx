const EMOTIONS = {
  calm: { color: "var(--accent-primary)", label: "Спокоен" },
  playful: { color: "var(--accent-warm)", label: "Игрив" },
  afraid: { color: "var(--accent-danger)", label: "Испуган" },
  grieving: { color: "var(--accent-secondary)", label: "Скорбит" },
} as const;

export type EmotionKind = keyof typeof EMOTIONS;

export function EmotionIndicator({
  emotion = "calm",
  size = 12,
  pulse = false,
}: {
  emotion?: EmotionKind;
  size?: number;
  pulse?: boolean;
}) {
  const e = EMOTIONS[emotion] ?? EMOTIONS.calm;
  return (
    <span title={e.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: e.color,
          boxShadow: `0 0 8px ${e.color}`,
          animation: pulse ? "aur-pulse-glow 2.4s var(--ease-drift) infinite" : "none",
        }}
      />
    </span>
  );
}
