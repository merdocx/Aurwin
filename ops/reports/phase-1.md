# Отчёт по фазе 1 «Каркас»

Дата: 2026-07-30

## Что сделано

- **Монорепозиторий на npm workspaces** под компоненты А.1:
  - `services/sim-engine` — тик-цикл (заготовка процесса, логика тика — фаза 2+);
  - `services/reflection-worker` — очередь LLM-рефлексий (заготовка; реальные
    LLM-вызовы запрещены до фазы 6 — п.7 «Незыблемых правил», рефлексия замокана);
  - `services/api-gateway` — WebSocket/REST слой, только чтение (заготовка);
  - `apps/frontend` — React + Vite + PixiJS (как зависимость на будущее),
    минимальная страница-плейсхолдер.
  - Общий корневой `package.json` (workspaces: `services/*`, `apps/*`), общий
    `tsconfig.base.json`.
- **`config/constants.yaml`** — все 52 константы из таблицы А.9 ТЗ, сгруппированы
  по смыслу (time, population, reflection, memory, utility_ai, world, social,
  life_stages, movement, decision_log, skills, signaling, kinship, day_night,
  authority). У каждой константы — комментарий с обоснованием из ТЗ и
  оценкой чувствительности («что крутить первым при разбалансировке»).
- **`docker-compose.yml`**: `postgres:16-alpine` без публикации порта наружу
  (`expose: 5432`, без `ports:`), healthcheck через `pg_isready`, том `pgdata`
  для персистентности. Заготовки `sim-engine`, `reflection-worker`,
  `api-gateway` (порт 3000), `frontend` (порт 5173, Vite dev-сервер) —
  каждая со своим Dockerfile, сборка через `docker compose build` из корня
  монорепо (нужен весь workspace-контекст).
- **`.gitignore`** — исключает `.env`, `.env.*` (кроме `.env.example`),
  `node_modules/`, `dist/`, `coverage/`, `ops/logs/`, данные Postgres и т.д.
- **`.env.example`** — шаблон переменных окружения (`ANTHROPIC_API_KEY`,
  `POSTGRES_PASSWORD`, `AURWIN_ENV`) без значений.
- **`npm test`** (vitest) — smoke-тест `tests/constants.smoke.test.ts`:
  парсит `config/constants.yaml` и проверяет наличие всех 52 путей-ключей,
  соответствующих строкам таблицы А.9 (90 проверок с учётом `describe`/`it.each`).
- **`README.md`** — состав монорепозитория, требования, команды установки,
  тестов, `docker compose up -d`, локальной разработки сервисов без Docker,
  описание `config/constants.yaml` и журнала балансировки.
- **`git init`** + первый коммит `3ac7bff` (`phase 1: каркас репозитория`).

## Чем проверено (гейт фазы 1)

1. `npm install && npm test` → **зелёный**: `Test Files 1 passed (1)`,
   `Tests 90 passed (90)`.
2. `docker compose config --quiet` → синтаксис compose-файла валиден,
   переменные из `.env` подставляются.
3. `docker compose up -d --build` → все 5 контейнеров подняты:
   `postgres` (healthy), `sim-engine`, `reflection-worker`, `api-gateway`,
   `frontend` — все в статусе `Up`.
4. `docker port aurwin-postgres-1` → пусто (порт наружу не публикуется);
   попытка подключения с хоста на `127.0.0.1:5432` → `Connection refused`
   (ожидаемо, доступ только внутри docker-сети `aurwin_default`).
5. `curl http://localhost:5173/` → `HTTP 200` (Vite-заготовка фронтенда отвечает).
6. `git status` → `nothing to commit, working tree clean`.
7. `git ls-files | grep '^\.env$'` → пусто, `.env` в индекс не попал.

## Что не сделано (сознательно, вне рамок фазы 1)

- Тик-пайплайн (А.3), utility AI (А.4), схема БД (А.2) — не реализованы,
  сервисы содержат только заготовки процессов (`console.log` + keep-alive).
  Это предмет фазы 2 «Мир» и фазы 4 «Существа/поведение».
  Ошибка "фаза не сходится" по 502 отсутствует, так как рефлексия сознательно
  не запускается.
- `api-gateway` слушает порт 3000 в docker-compose, но HTTP/WebSocket-сервер
  ещё не реализован (заготовка не поднимает `listen()`) — поэтому
  `curl http://localhost:3000/` возвращает пустой ответ. Это ожидаемо для
  фазы 1 и будет закрыто вместе с реализацией api-gateway.
- Реальные вызовы Anthropic API не производятся и не будут производиться
  до фазы 6 (п.7 «Незыблемых правил»); ключ `ANTHROPIC_API_KEY` в `.env`
  не используется кодом на этом этапе.
- Миграции схемы БД (А.2) не созданы — Postgres поднимается с пустой БД
  `aurwin`; создание таблиц — задача фазы 2/3.
- `npm audit` показывает 5 уязвимостей (в т.ч. critical) в транзитивных
  dev-зависимостях `esbuild`/`vite`/`vitest` — это известная уязвимость
  dev-сервера esbuild (запросы к dev-серверу с произвольного сайта), не
  затрагивает продакшн-рантайм и не относится к рантайм-зависимостям
  сервисов. Оставлено без изменений в фазе 1, чтобы не тянуть breaking-апдейт
  vite 5→8 без необходимости; при появлении признаков реальной угрозы —
  разобрать отдельно.

## Отклонения от ТЗ

Отклонений от ТЗ, требующих записи в `ops/DEVIATIONS.md`, в рамках фазы 1
не возникло.
