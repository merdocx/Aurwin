/*
 * Вспомогательные агрегаты для политики ретенции (А.2, абзац "ПОЛИТИКА
 * РЕТЕНЦИИ"). НЕ входят в список 12 обязательных таблиц А.2 — это только
 * назначение хранилища для сворачивания world_events/signals после
 * истечения полного построчного хранения (services/db/src/maintenance).
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE world_events_daily_agg (
      day    DATE NOT NULL,
      type   TEXT NOT NULL,
      count  INT NOT NULL,
      PRIMARY KEY (day, type)
    );

    CREATE TABLE signals_daily_agg (
      day           DATE NOT NULL,
      species       creature_species NOT NULL,
      type          signal_type NOT NULL,
      total         INT NOT NULL,
      disconfirmed  INT NOT NULL,
      PRIMARY KEY (day, species, type)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS signals_daily_agg;
    DROP TABLE IF EXISTS world_events_daily_agg;
  `);
};
