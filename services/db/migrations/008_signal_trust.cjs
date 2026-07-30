/* Кредит доверия к сигналам конкретного отправителя (7.8.4). ТЗ А.2. */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE signal_trust (
      observer_id       UUID NOT NULL REFERENCES creatures (id),
      signaler_id       UUID NOT NULL REFERENCES creatures (id),
      trust             REAL NOT NULL,          -- 0..1, старт 0.6
      confirmations     INT NOT NULL DEFAULT 0,
      disconfirmations  INT NOT NULL DEFAULT 0,
      PRIMARY KEY (observer_id, signaler_id)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS signal_trust;`);
};
