# Aurwin

[![npm test](https://github.com/merdocx/Aurwin/actions/workflows/test.yml/badge.svg)](https://github.com/merdocx/Aurwin/actions/workflows/test.yml)

Живая 24/7-симуляция колонии пингвинов и касаток: существа принимают решения
через utility AI, а личность каждого — характер, память, self-narrative —
развивается через периодическую LLM-рефлексию (Claude). Полное техническое
задание: [`docs/AURWIN_TZ.md`](docs/AURWIN_TZ.md).

Продакшен: **https://aurwin.ru** (фаза 7 «Эксплуатация»).

## Состав монорепозитория

npm workspaces, единый корневой `package.json`:

| Путь | Компонент | Ответственность (ТЗ А.1) |
|---|---|---|
| `services/sim-engine` | sim-engine | Тик-цикл 24/7: utility AI, биочасы, события, запись состояния |
| `services/reflection-worker` | reflection-worker | Очередь LLM-рефлексий: дебаунс, слияние, batch, ретраи |
| `services/api-gateway` | api-gateway | WebSocket-поток + REST для карточек, только чтение |
| `services/db` | @aurwin/db | Схема Postgres (А.2), миграции (node-pg-migrate), скрипты ретенции |
| `apps/frontend` | frontend | React + SVG/CSS Observatory, read-only рендер мира |
| `config/constants.yaml` | — | Единый источник правды для всех констант симуляции (табл. А.9) |

## Требования

- Node.js 20+
- Docker + Docker Compose v2

## Установка

```bash
npm install
cp .env.example .env   # заполнить ANTHROPIC_API_KEY / POSTGRES_PASSWORD / GRAFANA_ADMIN_PASSWORD
```

`.env` никогда не коммитится (см. `.gitignore` и CLAUDE.md, «Незыблемые
правила», п.1); ключ Anthropic не должен появляться во фронтенд-коде ни в
каком виде (п.2).

## Тесты

```bash
npm test
```

Тесты поднимают одноразовый контейнер `postgres:16-alpine` через Docker
(см. `tests/setup/global-db-setup.ts`) — нужен доступный `docker`, но не
обязательно полный `docker compose` стек.

CI: GitHub Actions [`.github/workflows/test.yml`](.github/workflows/test.yml)
гоняет `npm test` на каждый push/PR в `main` (и вручную через
`workflow_dispatch`). На `main` включён required check `npm test`.

## Схема БД и миграции (services/db)

```bash
DATABASE_URL=postgres://aurwin:<пароль>@localhost:5432/aurwin \
  npm run migrate:up --workspace=@aurwin/db
```

Таблицы А.2 + агрегаты ретенции + `learning_events`, `creatures.activity`,
`continuous_starvation_real_hours`. Скрипты обслуживания —
`services/db/src/maintenance/`.

## Запуск через Docker Compose

```bash
docker compose up -d
```

Поднимает `postgres` (порт наружу не публикуется), `sim-engine`,
`reflection-worker`, `api-gateway`, `frontend`, `caddy` (HTTPS), опционально
Prometheus/Grafana/Alertmanager.

```bash
docker compose ps
docker compose logs -f sim-engine
```

БД мира не удаляется без явного указания (CLAUDE.md, п.6).

## Локальная разработка

```bash
docker compose up -d postgres
npm run dev --workspace=@aurwin/sim-engine
npm run dev --workspace=@aurwin/api-gateway
npm run dev --workspace=@aurwin/frontend
```

## Константы симуляции

Только [`config/constants.yaml`](config/constants.yaml). Изменения —
[`ops/BALANCE_LOG.md`](ops/BALANCE_LOG.md). Расхождения с ТЗ —
[`ops/DEVIATIONS.md`](ops/DEVIATIONS.md).

## Стек

Node.js/TypeScript, PostgreSQL, WebSocket, React (Observatory UI), Caddy,
docker-compose.

## Документы

- Полное ТЗ: [`docs/AURWIN_TZ.md`](docs/AURWIN_TZ.md)
- Расхождения с ТЗ: [`ops/DEVIATIONS.md`](ops/DEVIATIONS.md)
- Журнал балансировки: [`ops/BALANCE_LOG.md`](ops/BALANCE_LOG.md)
- Ops: [`ops/README.md`](ops/README.md)
