/*
 * Журнал событий обучения (дельты черт/весов, применение рефлексии и т.п.).
 * Append-only; индекс по (creature_id, tick) для выборок по особи.
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE learning_events (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tick         BIGINT NOT NULL,
      creature_id  UUID NOT NULL REFERENCES creatures (id),
      kind         TEXT NOT NULL,
      payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX idx_learning_events_creature_tick ON learning_events (creature_id, tick);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS learning_events;`);
};
