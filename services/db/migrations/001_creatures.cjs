/* Существа (текущее состояние). ТЗ docs/AURWIN_TZ.md, А.2. */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE creature_species AS ENUM ('penguin', 'orca');
    CREATE TYPE creature_sex AS ENUM ('m', 'f');
    CREATE TYPE death_cause AS ENUM ('age', 'starvation', 'predation');

    CREATE TABLE creatures (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      species            creature_species NOT NULL,
      name               TEXT NOT NULL,
      sex                creature_sex NOT NULL,
      born_at_tick       BIGINT NOT NULL,
      died_at_tick       BIGINT,
      death_cause        death_cause,
      -- Реальное время смерти (не из А.2 дословно): нужно скрипту ретенции
      -- episodes ("+30 суток после смерти существа") — см. ops/DEVIATIONS.md.
      died_at            TIMESTAMPTZ,
      parent_a           UUID REFERENCES creatures (id),
      parent_b           UUID REFERENCES creatures (id),
      pos_x              REAL NOT NULL DEFAULT 0,
      pos_y              REAL NOT NULL DEFAULT 0,
      zone               TEXT,
      -- {courage, curiosity, sociability, aggression, caution, expressiveness}: -1..1
      traits             JSONB NOT NULL,
      -- снимок traits при рождении (цель 6: измерение дрейфа характера)
      traits_birth       JSONB NOT NULL,
      -- {hunger, energy, social, sleep_pressure}: 0..1
      needs              JSONB NOT NULL,
      -- {valence: -1..1, arousal: 0..1}
      emotion            JSONB NOT NULL,
      -- [{text, utility_hints}], от последней рефлексии
      intentions         JSONB NOT NULL DEFAULT '[]',
      -- полный self-narrative; наблюдателю не отдаётся (6.1)
      narrative          TEXT,
      -- 1-3 выжимки для карточки наблюдателя
      narrative_facts    JSONB NOT NULL DEFAULT '[]',
      -- {foraging, evasion, socializing, hunting, parenting}: 0..0.9 (7.7)
      skills             JSONB NOT NULL,
      -- -1..1, наследуемая склонность засыпать раньше/позже (7.10)
      chronotype         REAL NOT NULL,
      is_asleep          BOOLEAN NOT NULL DEFAULT FALSE,
      -- 0..1, авторитетность как источник знания (7.7, механизм 5)
      authority          REAL NOT NULL DEFAULT 0,
      -- {zone_name: subjective_score -1..1}, личная карта ожиданий (7.7)
      habits             JSONB NOT NULL DEFAULT '{}',
      -- индивидуальные w_need/w_trait/w_skill/w_habit
      weights            JSONB NOT NULL,
      -- снимок weights при рождении (коридор дрейфа)
      weights_birth      JSONB NOT NULL,
      -- тик последней рефлексии (дебаунс, 7.3)
      last_reflection_at BIGINT
    );

    CREATE INDEX idx_creatures_species ON creatures (species);
    CREATE INDEX idx_creatures_zone ON creatures (zone);
    CREATE INDEX idx_creatures_alive ON creatures (species) WHERE died_at_tick IS NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS creatures;
    DROP TYPE IF EXISTS death_cause;
    DROP TYPE IF EXISTS creature_sex;
    DROP TYPE IF EXISTS creature_species;
  `);
};
