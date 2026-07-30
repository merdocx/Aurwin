/*
 * Лог utility-решений (цель 2). Семплированный по decision_log.* из
 * config/constants.yaml (когорта наблюдаемых + окна после событий),
 * TTL — decision_log.ttl_days (7 суток). ТЗ А.2.
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE decision_log (
      creature_id    UUID NOT NULL REFERENCES creatures (id),
      tick           BIGINT NOT NULL,
      chosen_action  TEXT NOT NULL,
      factors        JSONB NOT NULL,
      -- реальное время записи: нужно TTL-прунингу (decision_log.ttl_days)
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX idx_decision_log_creature_tick ON decision_log (creature_id, tick);
    CREATE INDEX idx_decision_log_created_at ON decision_log (created_at);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS decision_log;`);
};
