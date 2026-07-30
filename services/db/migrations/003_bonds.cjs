/*
 * Симметричные связи (дружба/партнёрство). ТЗ А.2.
 * ИНВАРИАНТ: creature_a < creature_b (UUID-порядок) — пара хранится один раз
 * в каноническом порядке, иначе одна пара могла бы попасть в таблицу дважды
 * и разъехаться по strength.
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TYPE bond_kind AS ENUM ('friend', 'mate');

    CREATE TABLE bonds (
      creature_a  UUID NOT NULL REFERENCES creatures (id),
      creature_b  UUID NOT NULL REFERENCES creatures (id),
      kind        bond_kind NOT NULL,
      -- 0..1; friend при strength >= social.friendship.threshold (А.9)
      strength    REAL NOT NULL,
      PRIMARY KEY (creature_a, creature_b),
      CONSTRAINT bonds_canonical_order CHECK (creature_a < creature_b)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS bonds;
    DROP TYPE IF EXISTS bond_kind;
  `);
};
