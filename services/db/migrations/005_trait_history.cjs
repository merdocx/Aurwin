/* История дрейфа черт (цель 6, append-only). ТЗ А.2. */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE trait_history_source AS ENUM ('birth', 'reflection');

    CREATE TABLE trait_history (
      creature_id  UUID NOT NULL REFERENCES creatures (id),
      tick         BIGINT NOT NULL,
      traits       JSONB NOT NULL,
      source       trait_history_source NOT NULL
    );

    CREATE INDEX idx_trait_history_creature_tick ON trait_history (creature_id, tick);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS trait_history;
    DROP TYPE IF EXISTS trait_history_source;
  `);
};
