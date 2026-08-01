/*
 * Счётчик голодания для корректного restore после рестарта (аудит P1):
 * continuousStarvationRealHours раньше всегда сбрасывался в 0.
 */

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE creatures
      ADD COLUMN IF NOT EXISTS continuous_starvation_real_hours REAL NOT NULL DEFAULT 0;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE creatures DROP COLUMN IF EXISTS continuous_starvation_real_hours;
  `);
};
