import { useEffect, useState } from "react";
import { fetchCreatureCard, type CreatureCard as CreatureCardDto } from "../api/client";
import { Badge } from "../ds/Badge";
import { EmotionIndicator, type EmotionKind } from "../ds/EmotionIndicator";
import { NeedBar } from "../ds/NeedBar";
import { Timeline } from "../ds/Timeline";
import { TraitBar } from "../ds/TraitBar";
import { eventTimelineLabel } from "../world/eventLabels";

interface Props {
  creatureId: string;
  onName?: (name: string) => void;
}

const TRAIT_LABEL: Record<string, string> = {
  courage: "смелость",
  curiosity: "любопытство",
  sociability: "общительность",
  aggression: "агрессия",
  caution: "осторожность",
  expressiveness: "выразительность",
};
const NEED_LABEL: Record<string, string> = {
  hunger: "голод",
  energy: "энергия",
  social: "социальность",
  sleep_pressure: "давление сна",
};
const ZONE_LABEL: Record<string, string> = {
  main_ice: "основной лёд",
  far_ice: "дальний лёд",
  east_ice: "восточный лёд",
  north_bay: "северная бухта",
  south_shallows: "южное мелководье",
  open_water: "открытая вода",
};
function emotionFromCard(card: CreatureCardDto): EmotionKind {
  const { valence, arousal } = card.emotion;
  if (valence < -0.35 && arousal > 0.45) return "afraid";
  if (valence < -0.25) return "grieving";
  if (valence > 0.2 && arousal > 0.45) return "playful";
  return "calm";
}

/** Содержимое карточки для Dialog из design system (ui_kits/observatory). */
export function CreatureCardPanel({ creatureId, onName }: Props) {
  const [card, setCard] = useState<CreatureCardDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCard(null);
    setError(null);
    fetchCreatureCard(creatureId)
      .then((c) => {
        if (cancelled) return;
        setCard(c);
        onName?.(c.name);
      })
      .catch((err) => !cancelled && setError(String(err)));
    return () => {
      cancelled = true;
    };
    // onName — колбэк родителя; намеренно не в deps, чтобы не перезапрашивать карточку.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creatureId]);

  if (error) return <p style={{ color: "var(--accent-danger)", margin: 0 }}>Не удалось загрузить карточку.</p>;
  if (!card) return <p style={{ color: "var(--fg-tertiary)", margin: 0 }}>Загрузка…</p>;

  const emotion = emotionFromCard(card);
  const topHabits = Object.entries(card.habits)
    .filter(([, score]) => Number.isFinite(score))
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
    .slice(0, 3);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", fontFamily: "var(--font-sans)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <EmotionIndicator emotion={emotion} pulse={emotion === "afraid"} />
          <span style={{ fontSize: 13, color: "var(--fg-tertiary)" }}>
            {card.sex === "m" ? "самец" : "самка"} · {card.age_weeks.toFixed(1)} нед. · {card.is_asleep ? "спит" : "бодрствует"}
          </span>
        </div>
        <Badge tone={card.species === "orca" ? "violet" : "teal"}>
          {card.species === "orca" ? "Касатка" : "Пингвин"}
        </Badge>
      </div>

      {!card.alive && (
        <p style={{ margin: 0, color: "var(--accent-danger)", fontSize: 13 }}>
          покинул(а) мир{card.death_cause ? ` (${card.death_cause})` : ""}
        </p>
      )}

      {card.mate && (
        <section style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--fg-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>пара</span>
          <p style={{ margin: 0, fontSize: 14, color: "var(--fg-secondary)" }}>
            {card.mate.name}
            {card.mate.sex === "m" ? " ♂" : " ♀"}
            {!card.mate.alive ? " †" : ""}
            <span style={{ color: "var(--fg-tertiary)" }}> · связь {(card.mate.strength * 100).toFixed(0)}%</span>
          </p>
        </section>
      )}

      {card.narrative_facts.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
          {card.narrative_facts.map((fact, i) => (
            <li key={i} style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 14, color: "var(--fg-secondary)" }}>
              — {fact}
            </li>
          ))}
        </ul>
      )}

      {card.intentions.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--fg-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>намерения</span>
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 3, color: "var(--fg-secondary)", fontSize: 13 }}>
            {card.intentions.map((intention, index) => (
              <li key={`${intention.text}-${index}`}>{intention.text}</li>
            ))}
          </ul>
        </section>
      )}

      {topHabits.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--fg-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>привычные зоны</span>
          {topHabits.map(([zone, score]) => {
            const preference = Math.round(score * 100);
            return (
              <div key={zone} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, color: "var(--fg-secondary)" }}>
                <span>{ZONE_LABEL[zone] ?? zone}</span>
                <span style={{ color: score >= 0 ? "var(--accent-primary)" : "var(--accent-danger)" }}>
                  {preference > 0 ? "+" : ""}
                  {preference}%
                </span>
              </div>
            );
          })}
        </section>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {Object.entries(card.traits).map(([trait, value]) => (
          <TraitBar key={trait} label={TRAIT_LABEL[trait] ?? trait} value={value} />
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {Object.entries(card.needs).map(([need, value]) => (
          <NeedBar key={need} label={NEED_LABEL[need] ?? need} value={value} />
        ))}
      </div>

      {card.leading_skills.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {card.leading_skills.map(({ skill, value }) => (
            <NeedBar key={skill} label={skill} value={value} tone="violet" />
          ))}
        </div>
      )}

      <Timeline
        events={card.timeline.map((event) => ({
          when: `тик ${event.tick}`,
          text: eventTimelineLabel(event.type),
        }))}
      />
      {card.timeline.length === 0 && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--fg-tertiary)" }}>пока ничего не произошло</p>
      )}
    </div>
  );
}
