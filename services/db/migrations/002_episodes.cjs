/* Эпизодическая память (append-only, с прунингом). ТЗ А.2. */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE episodes (
      id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      creature_id             UUID NOT NULL REFERENCES creatures (id),
      tick                    BIGINT NOT NULL,
      -- 'friend_died','hunt_success','birth','bond_formed', ...
      type                    TEXT NOT NULL,
      participants            UUID[] NOT NULL DEFAULT '{}',
      significance            REAL NOT NULL,
      consumed_by_reflection  BOOLEAN NOT NULL DEFAULT FALSE,
      -- NULL = пережито лично; иначе источник передачи (7.7, механизмы 3 и 5)
      learned_from            UUID REFERENCES creatures (id),
      -- 0 = личный опыт, 1 = от очевидца, 2+ = предание
      transmission_depth      INT NOT NULL DEFAULT 0,
      -- significance >= 0.9 при создании: не удаляется прунингом до смерти существа
      core_memory             BOOLEAN NOT NULL DEFAULT FALSE,
      -- реальное время создания записи: нужно для затухания significance
      -- (х0.90/х0.97 за реальные сутки) и для ретенции "+30 суток после смерти"
      created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      -- последний момент, когда к significance было применено затухание
      decayed_at              TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX idx_episodes_creature_id ON episodes (creature_id);
    CREATE INDEX idx_episodes_pruning ON episodes (creature_id, consumed_by_reflection, significance);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS episodes;`);
};
