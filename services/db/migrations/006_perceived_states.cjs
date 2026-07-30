/*
 * Воспринимаемое состояние (7.8.1). Разреженно: только для реально
 * наблюдаемых пар; запись удаляется, когда воспринимаемое сошлось с
 * истинным (затухание, обрабатывается тик-пайплайном) или истёк TTL, а
 * также при смерти любой из сторон (services/db/src/maintenance). ТЗ А.2.
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE perceived_states (
      observer_id       UUID NOT NULL REFERENCES creatures (id),
      subject_id        UUID NOT NULL REFERENCES creatures (id),
      perceived_vigor   REAL NOT NULL,   -- 0..1, оценка бодрости жертвы
      perceived_threat  REAL NOT NULL,   -- 0..1, оценка опасности хищника
      last_signal_tick  BIGINT,
      PRIMARY KEY (observer_id, subject_id)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS perceived_states;`);
};
