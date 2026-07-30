/*
 * Воспринимаемая опасность ЗОНЫ — отдельно от долговременных habits (7.7):
 * alarm_call создаёт кратковременную панику, а не переоценку места на всю
 * жизнь. Затухание 15%/тик — быстрее, чем у perceived_states. ТЗ А.2.
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE perceived_zone_threat (
      observer_id  UUID NOT NULL REFERENCES creatures (id),
      zone         TEXT NOT NULL,
      threat       REAL NOT NULL, -- 0..1
      PRIMARY KEY (observer_id, zone)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS perceived_zone_threat;`);
};
