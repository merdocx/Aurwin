/*
 * Лента событий мира (таймлайн карточки, лента наблюдателя). ТЗ А.2.
 * Типы включают: birth, death, bond_formed, bond_broken, hunt_attempt,
 * hunt_success, matured, grew_old, signal_sent, signal_disconfirmed,
 * woken_by_alarm, guard_started, provisioned, coordinated_hunt,
 * day_break, night_fall.
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE world_events (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tick        BIGINT NOT NULL,
      type        TEXT NOT NULL,
      actor_id    UUID REFERENCES creatures (id),
      target_id   UUID REFERENCES creatures (id),
      zone        TEXT,
      payload     JSONB NOT NULL DEFAULT '{}',
      -- реальное время записи: нужно ретенции (90 суток полных, далее суточные агрегаты)
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX idx_world_events_tick ON world_events (tick);
    CREATE INDEX idx_world_events_type ON world_events (type);
    CREATE INDEX idx_world_events_created_at ON world_events (created_at);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS world_events;`);
};
