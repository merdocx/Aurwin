/**
 * Единый словарь подписей/тонов событий для карты (badge), ленты и карточки.
 */
export interface EventLabelInfo {
  /** Подпись на карте / в ленте событий. */
  label: string;
  /** Краткая форма для таймлайна карточки. */
  shortLabel: string;
  /** CSS-цвет маркера. */
  tone: string;
}

export const EVENT_INFO: Record<string, EventLabelInfo> = {
  death: {
    label: "Не пережил встречу с касаткой",
    shortLabel: "покинул мир",
    tone: "var(--fg-tertiary)",
  },
  hunt_success: {
    label: "Удачная охота",
    shortLabel: "успешная охота",
    tone: "var(--aurora-teal-500)",
  },
  hunt_attempt: {
    label: "Попытка охоты",
    shortLabel: "попытка охоты",
    tone: "var(--accent-danger)",
  },
  birth: {
    label: "Родился детёныш",
    shortLabel: "родился",
    tone: "var(--amber-400)",
  },
  provisioned: {
    label: "Покормил(а) детёныша",
    shortLabel: "покормил(а) детёныша",
    tone: "var(--amber-400)",
  },
  woken_by_alarm: {
    label: "Разбужен(а) тревогой",
    shortLabel: "разбужен(а) тревогой",
    tone: "var(--accent-warm)",
  },
  forage_success: {
    label: "Поймал рыбу",
    shortLabel: "поймал(а) рыбу",
    tone: "var(--aurora-teal-500)",
  },
  flee: {
    label: "Бегство",
    shortLabel: "убежал(а)",
    tone: "var(--accent-danger)",
  },
  reintroduction: {
    label: "Вернулись в мир",
    shortLabel: "вернулся(ась) в мир",
    tone: "var(--aurora-teal-500)",
  },
  bond_formed: {
    label: "Завёл(а) дружбу",
    shortLabel: "завёл(а) дружбу",
    tone: "var(--aurora-teal-500)",
  },
  bond_broken: {
    label: "Дружба распалась",
    shortLabel: "дружба распалась",
    tone: "var(--fg-tertiary)",
  },
  mate_bonded: {
    label: "Пара сложилась",
    shortLabel: "нашёл(а) пару",
    tone: "var(--amber-400)",
  },
  mate_breakup: {
    label: "Пара распалась",
    shortLabel: "пара распалась",
    tone: "var(--fg-tertiary)",
  },
  offense: {
    label: "Отвергнут(а)",
    shortLabel: "отвергнут(а)",
    tone: "var(--accent-danger)",
  },
  matured: {
    label: "Повзрослел(а)",
    shortLabel: "повзрослел(а)",
    tone: "var(--aurora-violet-500)",
  },
  grew_old: {
    label: "Постарел(а)",
    shortLabel: "постарел(а)",
    tone: "var(--fg-tertiary)",
  },
  signal_sent: {
    label: "Подал(а) сигнал",
    shortLabel: "подал(а) сигнал",
    tone: "var(--accent-warm)",
  },
  guard_started: {
    label: "На охране потомства",
    shortLabel: "встал(а) на охрану потомства",
    tone: "var(--aurora-teal-500)",
  },
  coordinated_hunt: {
    label: "Совместная охота",
    shortLabel: "совместная охота",
    tone: "var(--accent-danger)",
  },
  alarm_call: {
    label: "Тревожный крик",
    shortLabel: "тревожный крик",
    tone: "var(--accent-danger)",
  },
  display_vigor: {
    label: "Демонстрация силы",
    shortLabel: "демонстрация силы",
    tone: "var(--accent-warm)",
  },
};

export const SIGNAL_PULSE_TONES: Record<string, string> = {
  alarm_call: "var(--accent-danger)",
  display_vigor: "var(--accent-warm)",
  hunt_attempt: "var(--accent-danger)",
  woken_by_alarm: "var(--accent-warm)",
};

/** Типы событий, для которых на карте рисуется badge (не pulse). */
export const BADGE_EVENT_TYPES = new Set([
  "death",
  "hunt_success",
  "birth",
  "provisioned",
  "forage_success",
  "flee",
  "reintroduction",
  "bond_formed",
  "bond_broken",
  "mate_bonded",
  "mate_breakup",
  "offense",
  "matured",
  "grew_old",
  "guard_started",
  "coordinated_hunt",
]);

export function eventInfo(type: string): EventLabelInfo | undefined {
  return EVENT_INFO[type];
}

export function eventTimelineLabel(type: string): string {
  return EVENT_INFO[type]?.shortLabel ?? type;
}

export function eventLogLabel(type: string, payload?: Record<string, unknown>): string {
  if (type === "signal_sent") {
    const signalType = typeof payload?.signalType === "string" ? payload.signalType : null;
    if (signalType && EVENT_INFO[signalType]) return EVENT_INFO[signalType].label;
  }
  return EVENT_INFO[type]?.label ?? type;
}

/** Какой pulse рисовать для события (null = не pulse). */
export function signalPulseKind(type: string, payload?: Record<string, unknown>): string | null {
  if (type === "woken_by_alarm" || type === "hunt_attempt") return type;
  if (type === "alarm_call" || type === "display_vigor") return type;
  if (type === "signal_sent") {
    const signalType = typeof payload?.signalType === "string" ? payload.signalType : null;
    if (signalType === "alarm_call" || signalType === "display_vigor") return signalType;
  }
  return null;
}
