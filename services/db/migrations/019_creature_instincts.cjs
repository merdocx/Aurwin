/*
 * Врождённые инстинкты особи (JSON): speciesAffect / needDrive / mediumBias.
 * Seed из instincts.* в constants.yaml при genesis/birth; mild parent overlay.
 */

exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE creatures ADD COLUMN IF NOT EXISTS instincts JSONB;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE creatures DROP COLUMN IF EXISTS instincts;`);
};
