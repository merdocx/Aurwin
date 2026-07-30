/* Очередь и журнал рефлексий. ТЗ А.2, контракт входа/выхода — А.5. */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE reflection_kind AS ENUM ('genesis', 'background', 'event', 'milestone');
    CREATE TYPE reflection_status AS ENUM ('queued', 'sent', 'applied', 'discarded', 'failed');

    CREATE TABLE reflections (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      creature_id         UUID NOT NULL REFERENCES creatures (id),
      kind                reflection_kind NOT NULL,
      status              reflection_status NOT NULL DEFAULT 'queued',
      merged_episode_ids  UUID[] NOT NULL DEFAULT '{}',
      -- для аудита и отладки промптов; обнуляются через retention.reflections_audit_days
      request             JSONB,
      response            JSONB,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      applied_at          TIMESTAMPTZ
    );

    CREATE INDEX idx_reflections_creature ON reflections (creature_id);
    CREATE INDEX idx_reflections_status ON reflections (status);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS reflections;
    DROP TYPE IF EXISTS reflection_status;
    DROP TYPE IF EXISTS reflection_kind;
  `);
};
