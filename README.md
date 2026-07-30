# Aurwin

Живая 24/7-симуляция колонии пингвинов и касаток: существа принимают решения
через utility AI, а личность каждого — характер, память, self-narrative —
развивается через периодическую LLM-рефлексию (Claude). Полное техническое
задание: [`docs/AURWIN_TZ.md`](docs/AURWIN_TZ.md).

Текущая фаза: **2 — «Данные»** (схема PostgreSQL из А.2, миграции, скрипты
ретенции; тик-логика и рефлексия — предмет следующих фаз).

## Состав монорепозитория

npm workspaces, единый корневой `package.json`:

| Путь | Компонент | Ответственность (ТЗ А.1) |
|---|---|---|
| `services/sim-engine` | sim-engine | Тик-цикл 24/7: utility AI, биочасы, события, запись состояния |
| `services/reflection-worker` | reflection-worker | Очередь LLM-рефлексий: дебаунс, слияние, batch, ретраи |
| `services/api-gateway` | api-gateway | WebSocket-поток + REST для карточек, только чтение |
| `services/db` | @aurwin/db | Схема Postgres (А.2), миграции (node-pg-migrate), скрипты ретенции |
| `apps/frontend` | frontend | React + PixiJS, read-only рендер мира |
| `config/constants.yaml` | — | Единый источник правды для всех констант симуляции (табл. А.9) |

## Требования

- Node.js 20+
- Docker + Docker Compose v2

## Установка

```bash
npm install
cp .env.example .env   # заполнить ANTHROPIC_API_KEY / POSTGRES_PASSWORD
```

`.env` никогда не коммитится (см. `.gitignore` и CLAUDE.md, «Незыблемые
правила», п.1); ключ Anthropic не должен появляться во фронтенд-коде ни в
каком виде (п.2).

## Тесты

```bash
npm test
```

Фаза 1: smoke-тест `config/constants.yaml` (все константы табл. А.9 + блок
ретенции А.2). Фаза 2: тесты `services/db` — схема БД, инвариант `bonds`
(`creature_a < creature_b`), полный откат/повтор миграций, скрипты
обслуживания ретенции. Эти тесты сами поднимают одноразовый контейнер
`postgres:16-alpine` через Docker (см. `tests/setup/global-db-setup.ts`) —
для `npm test` нужен доступный `docker`, но НЕ обязательно поднятый
`docker compose` стек.

## Схема БД и миграции (services/db)

```bash
# Применить миграции (нужен DATABASE_URL, см. .env.example)
DATABASE_URL=postgres://aurwin:<пароль>@localhost:5432/aurwin \
  npm run migrate:up --workspace=@aurwin/db

# Откатить все миграции
DATABASE_URL=... npm run migrate:down --workspace=@aurwin/db
```

Все 12 таблиц из ТЗ А.2 (`creatures`, `episodes`, `bonds`, `aversions`,
`trait_history`, `perceived_states`, `perceived_zone_threat`, `signal_trust`,
`signals`, `reflections`, `world_events`, `decision_log`) + вспомогательные
агрегаты для ретенции (`world_events_daily_agg`, `signals_daily_agg`).
Скрипты обслуживания политики ретенции — `services/db/src/maintenance/`
(прунинг эпизодов, TTL `decision_log`, обнуление `reflections.request/response`,
прореживание `trait_history`, сворачивание `world_events`/`signals` в
агрегаты, удаление транзиентных записей при смерти существа).

## Запуск через Docker Compose

```bash
docker compose up -d
```

Поднимает `postgres` (без публикации порта наружу — доступен только другим
сервисам compose по имени `postgres`) и заготовки `sim-engine`,
`reflection-worker`, `api-gateway`, `frontend`.

Проверить состояние:

```bash
docker compose ps
docker compose logs -f
```

Остановить:

```bash
docker compose down          # с сохранением данных Postgres (volume pgdata)
```

БД мира не удаляется и не пересоздаётся без явного указания (CLAUDE.md, п.6).

## Локальная разработка отдельного сервиса (без Docker)

```bash
npm run dev --workspace=@aurwin/sim-engine
npm run dev --workspace=@aurwin/reflection-worker
npm run dev --workspace=@aurwin/api-gateway
npm run dev --workspace=@aurwin/frontend
```

Требуется поднятый `postgres` (`docker compose up -d postgres`).

## Константы симуляции

Все числовые параметры симуляции — только в
[`config/constants.yaml`](config/constants.yaml), по таблице А.9 ТЗ, с
комментарием-обоснованием и оценкой чувствительности у каждого значения. В
коде эти числа не хардкодятся. Любое изменение константы фиксируется в
[`ops/BALANCE_LOG.md`](ops/BALANCE_LOG.md) (когда, что, почему).

## Стек

Node.js/TypeScript, PostgreSQL, WebSocket, React + PixiJS, docker-compose
(ТЗ, раздел 7.5).

## Документы

- Полное ТЗ: [`docs/AURWIN_TZ.md`](docs/AURWIN_TZ.md)
- Расхождения с ТЗ: [`ops/DEVIATIONS.md`](ops/DEVIATIONS.md)
- Журнал балансировки констант: [`ops/BALANCE_LOG.md`](ops/BALANCE_LOG.md)
- Отчёты по фазам: [`ops/reports/`](ops/reports/)
