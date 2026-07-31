import { useEffect, useState } from "react";
import { fetchCreatureCard, type CreatureCard as CreatureCardDto } from "../api/client";

interface Props {
  creatureId: string;
  onClose: () => void;
}

const SPECIES_LABEL: Record<string, string> = { penguin: "Пингвин", orca: "Касатка" };
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
const EVENT_LABEL: Record<string, string> = {
  birth: "родился",
  death: "покинул мир",
  matured: "повзрослел(а)",
  grew_old: "постарел(а)",
  bond_formed: "завёл(а) дружбу",
  bond_broken: "дружба распалась",
  hunt_attempt: "попытка охоты",
  hunt_success: "успешная охота",
  signal_sent: "подал(а) сигнал",
  woken_by_alarm: "разбужен(а) тревогой",
  guard_started: "встал(а) на охрану потомства",
  provisioned: "покормил(а) детёныша",
  coordinated_hunt: "совместная охота",
};

function emotionFromCard(card: CreatureCardDto): "calm" | "playful" | "afraid" | "grieving" {
  const { valence, arousal } = card.emotion;
  if (valence < -0.35 && arousal > 0.45) return "afraid";
  if (valence < -0.25) return "grieving";
  if (valence > 0.2 && arousal > 0.45) return "playful";
  return "calm";
}

export function CreatureCard({ creatureId, onClose }: Props) {
  const [card, setCard] = useState<CreatureCardDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCard(null);
    setError(null);
    fetchCreatureCard(creatureId)
      .then((c) => !cancelled && setCard(c))
      .catch((err) => !cancelled && setError(String(err)));
    return () => {
      cancelled = true;
    };
  }, [creatureId]);

  return (
    <aside className="creature-card">
      <button className="creature-card__close" onClick={onClose} aria-label="закрыть" type="button">
        ×
      </button>
      {error && <p className="creature-card__error">Не удалось загрузить карточку.</p>}
      {!card && !error && <p>Загрузка…</p>}
      {card && (
        <>
          <div className="creature-card__header">
            <div className="creature-card__title-row">
              <span className={`emotion-dot emotion-dot--${emotionFromCard(card)}`} title="эмоция" />
              <h2>{card.name}</h2>
            </div>
            <span className={`creature-card__badge${card.species === "orca" ? " creature-card__badge--orca" : ""}`}>
              {SPECIES_LABEL[card.species] ?? card.species}
            </span>
          </div>
          <p className="creature-card__subtitle">
            {card.sex === "m" ? "самец" : "самка"} · {card.age_weeks.toFixed(1)} нед.
            {!card.alive && (
              <span className="creature-card__dead">
                {" "}
                · покинул(а) мир{card.death_cause ? ` (${card.death_cause})` : ""}
              </span>
            )}
            {" · "}
            {card.is_asleep ? "спит" : "бодрствует"}
          </p>

          {card.narrative_facts.length > 0 && (
            <section>
              <h3>Из истории жизни</h3>
              <ul className="creature-card__facts">
                {card.narrative_facts.map((fact, i) => (
                  <li key={i}>— {fact}</li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h3>Черты характера</h3>
            <ul className="creature-card__traits">
              {Object.entries(card.traits).map(([trait, value]) => (
                <li key={trait}>
                  <div className="creature-card__trait-head">
                    <span>{TRAIT_LABEL[trait] ?? trait}</span>
                    <span>{value.toFixed(2)}</span>
                  </div>
                  <TraitBar value={value} />
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3>Потребности</h3>
            <ul className="creature-card__needs">
              {Object.entries(card.needs).map(([need, value]) => (
                <li key={need}>
                  <div className="creature-card__need-head">
                    <span>{NEED_LABEL[need] ?? need}</span>
                    <span>{(value * 100).toFixed(0)}%</span>
                  </div>
                  <NeedBar value={value} />
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3>Ведущие навыки</h3>
            <ul className="creature-card__needs">
              {card.leading_skills.map(({ skill, value }) => (
                <li key={skill}>
                  <div className="creature-card__need-head">
                    <span>{skill}</span>
                    <span>{(value * 100).toFixed(0)}%</span>
                  </div>
                  <NeedBar value={value} />
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3>Лента событий</h3>
            <ol className="creature-card__timeline">
              {card.timeline.map((event) => (
                <li key={event.id}>
                  тик {event.tick}: {EVENT_LABEL[event.type] ?? event.type}
                </li>
              ))}
              {card.timeline.length === 0 && <li>пока ничего не произошло</li>}
            </ol>
          </section>
        </>
      )}
    </aside>
  );
}

function TraitBar({ value }: { value: number }) {
  const pct = ((value + 1) / 2) * 100;
  const left = value >= 0 ? 50 : pct;
  const width = Math.abs(pct - 50);
  return (
    <div className="creature-card__bar">
      <span className="creature-card__bar-mid" />
      <span className="creature-card__bar-fill" style={{ left: `${left}%`, width: `${width}%` }} />
    </div>
  );
}

function NeedBar({ value }: { value: number }) {
  const tone = value > 0.7 ? "coral" : value > 0.4 ? "amber" : "teal";
  return (
    <div className="creature-card__bar">
      <span className={`creature-card__need-fill creature-card__need-fill--${tone}`} style={{ width: `${value * 100}%` }} />
    </div>
  );
}
