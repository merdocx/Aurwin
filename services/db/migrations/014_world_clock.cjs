/*
 * Часы мира — синглтон-строка с текущим тиком/фазой суток. НЕ входит в
 * список 12 обязательных таблиц А.2 (тот же случай, что и
 * world_events_daily_agg/signals_daily_agg из 013 — вспомогательная
 * инфраструктура, необходимая, чтобы реализовать уже заданное требование
 * ТЗ). GET /api/world/stats (А.6, "возраст мира") и WS snapshot/delta (А.6)
 * фазы 5 нуждаются в дешёвом источнике "текущий тик/фаза без пересчёта по
 * world_events" — см. ops/DEVIATIONS.md, фаза 5.
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE world_clock (
      id          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      tick        BIGINT NOT NULL,
      phase       TEXT NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS world_clock;`);
};
