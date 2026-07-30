# Отчёт по фазе 2 «Данные»

Дата: 2026-07-30

## Что сделано

- **Новый workspace-пакет `services/db` (`@aurwin/db`)** — схема Postgres,
  миграции и скрипты обслуживания, зависимости: `pg`, `node-pg-migrate`,
  `js-yaml`.
- **13 миграций** (`services/db/migrations/001…013_*.cjs`, инструмент —
  `node-pg-migrate` v9, программный `runner()` через
  `services/db/src/migrate.ts`), создающие ВСЕ таблицы из ТЗ А.2:
  `creatures`, `episodes`, `bonds`, `aversions`, `trait_history`,
  `perceived_states`, `perceived_zone_threat`, `signal_trust`, `signals`,
  `reflections`, `world_events`, `decision_log` — плюс вспомогательные
  агрегатные таблицы `world_events_daily_agg`/`signals_daily_agg` для
  ретенции (не входят в 12 обязательных, см. `ops/DEVIATIONS.md`).
  - `creatures`: все поля из А.2 включены полностью — `traits` (с
    `expressiveness`), `traits_birth`, `needs` (с `sleep_pressure`),
    `emotion`, `intentions`, `narrative`, `narrative_facts`, `skills`,
    `chronotype`, `is_asleep`, `authority`, `habits`, `weights`,
    `weights_birth`, `last_reflection_at`.
  - `episodes`: `learned_from`, `transmission_depth`, `core_memory`
    (для core-памяти significance ≥ 0.9, которая не удаляется прунингом).
  - `bonds`: `PRIMARY KEY (creature_a, creature_b)` + `CHECK (creature_a <
    creature_b)` — инвариант из ТЗ реализован дословно.
  - `aversions`: направленная связь `subject_id -> object_id`, без
    канонизации порядка (сознательно НЕ симметрична, в отличие от `bonds`).
- **Скрипты обслуживания политики ретенции** (`services/db/src/maintenance/`):
  - `pruneEpisodes` — затухание significance (0.90/0.97 за реальные сутки,
    по виду), обрезка сверх лимита (50 пингвин / 80 касатка, сначала
    `consumed_by_reflection` с наименьшей significance, `core_memory` не
    трогается), полное удаление эпизодов через 30 суток после смерти
    существа;
  - `cleanupDecisionLog` — TTL 7 суток (`decision_log.ttl_days`);
  - `redactReflections` — обнуление `request`/`response` через 30 суток,
    метаданные остаются;
  - `thinTraitHistory` — после смерти существа: birth + первая/последняя
    запись + не чаще 1 записи в сутки жизни;
  - `rollupWorldEvents` / `rollupSignals` — свёртка в суточные агрегаты
    после 90/30 суток полного хранения соответственно, с удалением
    построчных данных;
  - `cleanupOnDeath` — удаление `perceived_states`, `perceived_zone_threat`,
    `signal_trust` при смерти любой из сторон.
  - Все пороги читаются из `config/constants.yaml` (новая секция
    `retention`), ни одно число не хардкожено в скриптах (CLAUDE.md, п.3-4).
- **`config/constants.yaml`**: добавлена секция `retention` (4 константы из
  абзаца "ПОЛИТИКА РЕТЕНЦИИ" в А.2, не входящего в табл. А.9 дословно, но
  того же типа "числа, которые крутят при обслуживании") — см.
  `ops/DEVIATIONS.md`, п.5. Тест `tests/constants.smoke.test.ts` расширен
  4 новыми проверками.
- **Тестовая инфраструктура БД** (`tests/setup/global-db-setup.ts` +
  `vitest.config.ts`): `npm test` сам поднимает одноразовый, изолированный
  от `docker-compose.yml` контейнер `postgres:16-alpine` на свободном
  loopback-порту через Docker CLI (`globalSetup`/`globalTeardown`),
  прогоняет тесты и гарантированно удаляет контейнер в конце — не требует
  предварительно поднятого `docker compose up`. `fileParallelism: false`,
  чтобы тестовые файлы, обращающиеся к общей БД (включая полный
  down/up миграций), не пересекались во времени.
- **124 теста** (`services/db/tests/*.test.ts`, 60 новых assert'ов сверх
  94 constants-тестов фазы 1):
  - `schema.test.ts` — все 12 таблиц существуют, все обязательные колонки
    `creatures`/`episodes`/`signals`/`reflections` на месте, у `bonds` есть
    CHECK с `creature_a`/`creature_b`, у `aversions` такого CHECK нет
    (направленность подтверждена структурно);
  - `bonds-invariant.test.ts` — вставка `(creature_a > creature_b)` падает,
    вставка в верном порядке проходит, повторная вставка той же пары падает
    по PRIMARY KEY;
  - `migrations-roundtrip.test.ts` — `down` (все миграции) полностью сносит
    схему, `up` восстанавливает её заново;
  - `maintenance.test.ts` — по одному-два теста на каждый скрипт
    обслуживания с реальными фикстурами (обрезка по лимиту с сохранением
    core_memory, удаление после смерти, TTL, обнуление reflections,
    прореживание trait_history, свёртка world_events/signals в агрегаты,
    удаление transient-записей при смерти).
- **Проверено и на реальном `docker-compose` Postgres** (не только на
  эфемерном тестовом контейнере): миграции применены к `aurwin-postgres-1`
  (все 15 таблиц, включая `pgmigrations`), затем полностью откачены и
  применены заново — тот же результат.

## Чем проверено (гейт фазы 2)

1. `npm test` → **зелёный**: `Test Files 5 passed (5)`, `Tests 124 passed
   (124)` (94 constants-теста фазы 1 + 30 в `services/db`), включая тест,
   явно требуемый заданием: попытка вставить `bonds` с `creature_a >
   creature_b` отклоняется БД.
2. `npx tsc -p services/db/tsconfig.json --noEmit` → без ошибок.
3. Ручной прогон против **реального** Postgres из `docker-compose`
   (`DATABASE_URL` на внутренний IP контейнера `aurwin-postgres-1`,
   порт наружу по-прежнему не публикуется):
   `npm run migrate:up --workspace=@aurwin/db` → 15 таблиц созданы;
   `npm run migrate:down --workspace=@aurwin/db` → откат до 1 таблицы
   (`pgmigrations`); `migrate:up` повторно → снова 15 таблиц.
4. `docker compose config --quiet` и `docker compose up -d --build` →
   все 5 контейнеров подняты без ошибок (`postgres` healthy, остальные Up).
5. После прогона тестов — `docker ps -a` не содержит осиротевших
   `aurwin-test-postgres` контейнеров (teardown отработал).

## Что не сделано (сознательно, вне рамок фазы 2)

- Ни один сервис (`sim-engine`, `reflection-worker`, `api-gateway`) пока не
  импортирует `@aurwin/db` и не подключается к БД в рантайме — это
  подключение схемы к тик-пайплайну (А.3) и API (А.6) относится к фазам
  3+. Фаза 2 — только схема, миграции и обслуживание.
- Скрипты обслуживания (`runRetentionMaintenance`) не подключены ни к
  какому cron/scheduler — это эксплуатационная обвязка вне схемы данных,
  тоже последующих фаз.
- `decayPerceivedStates` (схождение воспринимаемого с истинным без сигнала)
  и полноценное обновление `bonds`/`aversions`/`perceived_*` в реальном
  времени — логика тик-пайплайна (А.3), не задача схемы БД; в фазе 2
  реализовано только структурное удаление этих строк при смерти стороны.

## Отклонения от ТЗ

Задокументированы в [`ops/DEVIATIONS.md`](../DEVIATIONS.md): добавленные
сверх дословного текста А.2 колонки (`creatures.died_at`, `*.created_at`,
`episodes.decayed_at`, `episodes.core_memory`), две вспомогательные
агрегатные таблицы для ретенции, и новая секция `retention` в
`config/constants.yaml` — все обоснованы необходимостью реализовать саму
же политику ретенции, которую требует А.2.
