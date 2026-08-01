/*
 * Дополнения к персистентности мира (P3 ecosystem):
 *   - world_clock.fish_density — плотность рыбы по кормовым зонам (JSONB)
 *   - creatures.last_reproduced_at_tick — кулдаун размножения после рестарта
 * См. ops/DEVIATIONS.md, 2026-07-31 — P3 ecosystem persistence.
 */

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE world_clock
      ADD COLUMN IF NOT EXISTS fish_density JSONB;

    ALTER TABLE creatures
      ADD COLUMN IF NOT EXISTS last_reproduced_at_tick BIGINT;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE world_clock DROP COLUMN IF EXISTS fish_density;
    ALTER TABLE creatures DROP COLUMN IF EXISTS last_reproduced_at_tick;
  `);
};
