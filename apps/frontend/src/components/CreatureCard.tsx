import { useEffect, useState } from "react";
import { fetchCreatureCard, type CreatureCard as CreatureCardDto } from "../api/client";

interface Props {
  creatureId: string;
  onClose: () => void;
}

const SPECIES_LABEL: Record<string, string> = { penguin: "пингвин", orca: "касатка" };
const EVENT_LABEL: Record<string, string> = {
  birth: "родился",
  death: "погиб(ла)",
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
      <button className="creature-card__close" onClick={onClose} aria-label="закрыть">
        ×
      </button>
      {error && <p className="creature-card__error">Не удалось загрузить карточку.</p>}
      {!card && !error && <p>Загрузка…</p>}
      {card && (
        <>
          <h2>{card.name}</h2>
          <p className="creature-card__subtitle">
            {SPECIES_LABEL[card.species] ?? card.species} · {card.sex === "m" ? "самец" : "самка"} ·{" "}
            {card.age_weeks.toFixed(1)} нед.
            {!card.alive && <span className="creature-card__dead"> · погиб(ла){card.death_cause ? ` (${card.death_cause})` : ""}</span>}
          </p>

          <section>
            <h3>Черты характера</h3>
            <ul className="creature-card__traits">
              {Object.entries(card.traits).map(([trait, value]) => (
                <li key={trait}>
                  <span>{trait}</span>
                  <TraitBar value={value} />
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3>Ведущие навыки</h3>
            <ul>
              {card.leading_skills.map(({ skill, value }) => (
                <li key={skill}>
                  {skill}: {(value * 100).toFixed(0)}%
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3>Состояние</h3>
            <p>
              {card.is_asleep ? "спит 💤" : "бодрствует"} · настроение{" "}
              {card.emotion.valence > 0.15 ? "хорошее" : card.emotion.valence < -0.15 ? "тревожное" : "нейтральное"} · голод{" "}
              {(card.needs.hunger * 100).toFixed(0)}% · усталость {(card.needs.sleep_pressure * 100).toFixed(0)}%
            </p>
          </section>

          {card.narrative_facts.length > 0 && (
            <section>
              <h3>Из истории жизни</h3>
              <ul>
                {card.narrative_facts.map((fact, i) => (
                  <li key={i}>{fact}</li>
                ))}
              </ul>
            </section>
          )}

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
  return (
    <span className="creature-card__bar">
      <span className="creature-card__bar-fill" style={{ width: `${pct}%` }} />
    </span>
  );
}
