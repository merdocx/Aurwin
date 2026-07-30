/*
 * Избегание/страх — НАПРАВЛЕННАЯ связь (subject_id -> object_id), НЕ симметричная:
 * пингвин боится конкретной касатки, касатка о нём вообще не помнит.
 * Симметричная схема (как у bonds) это исказила бы, поэтому здесь нет
 * CHECK на порядок id и нет канонизации пары. ТЗ А.2.
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE aversions (
      subject_id  UUID NOT NULL REFERENCES creatures (id), -- кто боится/избегает
      object_id   UUID NOT NULL REFERENCES creatures (id), -- кого
      strength    REAL NOT NULL,                            -- 0..1, затухает со временем
      PRIMARY KEY (subject_id, object_id)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS aversions;`);
};
