/*
 * Наблюдаемый режим активности существа (walk/swim/hunt/…) для WS delta.
 * RAM-поля heading/wanderHeadingTicks не персистятся — только activity.
 */

exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE creatures ADD COLUMN IF NOT EXISTS activity TEXT;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE creatures DROP COLUMN IF EXISTS activity;`);
};
