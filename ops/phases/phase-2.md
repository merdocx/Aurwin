Задача: фаза 2 «Данные» проекта Aurwin.

Прочитай docs/AURWIN_TZ.md, раздел А.2 целиком.

Реализуй систему миграций и создай ВСЕ таблицы из А.2:
creatures, episodes, bonds, aversions, trait_history, perceived_states,
perceived_zone_threat, signal_trust, signals, reflections, world_events, decision_log.

Критично:
- инвариант bonds: CHECK (creature_a < creature_b) — пара не должна попадать дважды;
- aversions направленные (subject_id -> object_id), НЕ симметричные;
- поля creatures из А.2 полностью: traits (включая expressiveness), traits_birth,
  skills, habits, weights, weights_birth, chronotype, is_asleep, authority,
  last_reflection_at, needs (включая sleep_pressure);
- episodes: learned_from, transmission_depth;
- политика ретенции из А.2 — как отдельные функции/скрипты обслуживания
  (прунинг памяти, TTL decision_log, обнуление request/response в reflections и т.д.).

Тесты обязательны: попытка вставить bonds с creature_a > creature_b должна падать;
миграции применяются и откатываются.

Гейт: миграции up/down проходят, тесты зелёные.

По завершении: отчёт в ops/reports/phase-2.md.
