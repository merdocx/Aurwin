/*
 * Журнал поданных сигналов: нужен и для проверки подтверждения, и для
 * честности повествования (7.8.6). Расхождение true_state/claimed_state -
 * мера лживости сигнала: вычисляется, а не назначается флагом. ТЗ А.2.
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE signal_type AS ENUM ('display_vigor', 'alarm_call', 'stealth_approach');
    CREATE TYPE signal_outcome AS ENUM ('pending', 'confirmed', 'disconfirmed');

    CREATE TABLE signals (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      sender_id      UUID NOT NULL REFERENCES creatures (id),
      tick           BIGINT NOT NULL,
      type           signal_type NOT NULL,
      zone           TEXT,
      true_state     REAL NOT NULL,   -- истинное значение на момент подачи
      claimed_state  REAL NOT NULL,   -- что сигнал транслировал
      outcome        signal_outcome NOT NULL DEFAULT 'pending',
      receivers      UUID[] NOT NULL DEFAULT '{}',
      -- реальное время подачи сигнала: нужно ретенции (30 суток полных, далее агрегаты)
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX idx_signals_sender ON signals (sender_id);
    CREATE INDEX idx_signals_outcome ON signals (outcome);
    CREATE INDEX idx_signals_created_at ON signals (created_at);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS signals;
    DROP TYPE IF EXISTS signal_outcome;
    DROP TYPE IF EXISTS signal_type;
  `);
};
