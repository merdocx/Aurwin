# Aurwin — эксплуатация (фаза 7)

Оперативный справочник для 24/7-сервера. Полный источник требований —
[`docs/AURWIN_TZ.md`](../docs/AURWIN_TZ.md), раздел 6.1 (наблюдаемость) и
приложение А.7 («Деплой и эксплуатация»). Отклонения от буквы ТЗ —
[`DEVIATIONS.md`](DEVIATIONS.md).

## 1. Как смотреть метрики

Весь стек наблюдаемости — часть `docker compose up -d` (сервисы `prometheus`,
`alertmanager`, `grafana` в `docker-compose.yml`). Порты публикуются только на
`127.0.0.1` (как и Postgres — наружу не смотрят, см. CLAUDE.md/А.7):

| Что | URL | Логин |
|---|---|---|
| Grafana (дашборд «Aurwin — эксплуатация») | http://127.0.0.1:3001 | `admin` / `GRAFANA_ADMIN_PASSWORD` из `.env` |
| Prometheus (сырые запросы, `/graph`, `/alerts`) | http://127.0.0.1:9090 | — |
| Alertmanager (текущие сработавшие алёрты) | http://127.0.0.1:9093 | — |
| `/metrics` sim-engine (внутри сети compose) | `sim-engine:9464/metrics` | — |
| `/metrics` reflection-worker (внутри сети compose) | `reflection-worker:9465/metrics` | — |

Если сервер доступен только по SSH (нет туннеля до 127.0.0.1) — пробросить порт:
`ssh -L 3001:127.0.0.1:3001 -L 9090:127.0.0.1:9090 user@server`.

Единственный дашборд — `ops/observability/grafana/dashboards/aurwin.json`
(провижининг автоматический, правка файла подхватывается после `docker compose
restart grafana`). Панели покрывают все пункты 6.1: население по видам,
рождения/смерти по причинам, продолжительность жизни, ночные смерти от
хищника, поведенческая дивергенция когорт, среднее/стандартное отклонение
навыков, сигналы (поданные/опровергнутые), доверие и `w_vigor` касаток,
доля традиций (`transmission_depth ≥ 2`), сон (доля спящих, давление сна),
метрики LLM (вызовы по исходу, расход в USD, латентность p95).

Сырые счётчики можно смотреть напрямую (полезно при отладке одного числа):

```bash
docker compose exec -T sim-engine wget -qO- http://localhost:9464/metrics | grep aurwin_population
docker compose exec -T reflection-worker wget -qO- http://localhost:9465/metrics | grep aurwin_llm
```

## 2. Алёрты (А.7/А.9)

Правила — `ops/observability/prometheus/alerts.yml`, пороги зеркальны
`config/constants.yaml` → секция `alerting` (и `population.alert_thresholds`).
**При изменении порога в `constants.yaml` его нужно вручную повторить в
`alerts.yml`** — Prometheus не читает YAML симуляции напрямую.

| Алёрт | Условие | severity |
|---|---|---|
| `AurwinTickStalled` | тик не обновлялся > 120с | critical |
| `AurwinPenguinPopulationOutOfRange` | пингвины < 10 или > 120 (2 мин подряд) | warning |
| `AurwinOrcaPopulationOutOfRange` | касатки < 2 или > 12 (2 мин подряд) | warning |
| `AurwinLlmErrorRateHigh` | доля ошибок LLM > 50% за скользящий час (5 мин подряд) | critical |
| `AurwinLlmSpendOverBudget` | расход LLM за 24ч > $0.80 (2× план $0.40) | warning |

Посмотреть, что сейчас горит: http://127.0.0.1:9090/alerts или
`curl -s http://127.0.0.1:9090/api/v1/alerts`.

MVP не подключает внешний канал уведомлений (нет Slack/email в скоупе фазы 7,
см. `alertmanager.yml`) — Alertmanager группирует и показывает алёрты в своём
UI/API, этого достаточно для гейта фазы. Добавление webhook/email/Slack —
вопрос секции `receivers` в `ops/observability/alertmanager/alertmanager.yml`,
без изменения самих правил.

### Проверить правила алёртов без вмешательства в боевой мир

Гейт фазы 7 требует показать, что алёрт срабатывает на заниженной популяции —
это делается синтетическими рядами через `promtool test rules`, **не** правкой
реальных существ в БД (CLAUDE.md, «Незыблемые правила», п.6 — данные мира не
трогаем ради теста):

```bash
docker compose cp ops/observability/prometheus/alerts_test.yml prometheus:/tmp/alerts_test.yml
docker compose exec -T prometheus promtool test rules /tmp/alerts_test.yml
```

`alerts_test.yml` покрывает по одному срабатывающему и одному
не-срабатывающему сценарию для всех 4 правил (обе популяции, остановка тика,
доля ошибок LLM, расход LLM).

## 3. Как перезапустить

### Через systemd (рекомендуется на боевом сервере)

Юниты — `ops/systemd/*.service` и `*.timer`. Установка (один раз, на сервере,
см. Б.3/Б.5 ТЗ — предполагается непривилегированный пользователь `aurwin` в
группе `docker`):

```bash
sudo cp ops/systemd/*.service ops/systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now aurwin-sim-engine aurwin-reflection-worker aurwin-api-gateway
sudo systemctl enable --now aurwin-backup.timer aurwin-retention.timer
```

Юниты sim-engine/reflection-worker/api-gateway — тонкая обёртка над
`docker compose up -d <service>` (см. комментарий в
`aurwin-sim-engine.service`): docker-compose и так держит эти сервисы на
`restart: unless-stopped`, поэтому dockerd сам поднимет их при своём
рестарте после перезагрузки сервера — юниты дают явный, поимённый рычаг
(`systemctl restart aurwin-sim-engine`) и гарантированный порядок после
старта Docker.

```bash
systemctl status aurwin-sim-engine
systemctl restart aurwin-sim-engine       # мягкий рестарт: SIGTERM -> снапшот уже в БД -> новый процесс восстанавливается из него
journalctl -u aurwin-sim-engine -f
```

### Через docker compose напрямую (разработка/отладка)

```bash
docker compose ps                          # что сейчас поднято
docker compose logs -f sim-engine          # логи одного сервиса
docker compose restart sim-engine          # рестарт одного сервиса без остановки остальных
docker compose up -d --build sim-engine    # пересобрать образ после правки кода и поднять
docker compose down                        # остановить ВСЁ, данные (volume pgdata) сохраняются
```

`sim-engine` при старте вызывает `loadWorldState()` (`persistence/restore.ts`):
если `world_clock` уже содержит тик из предыдущего запуска — мир продолжается
с него (genesis НЕ повторяется), в лог пишется `мир восстановлен из снапшота:
тик N, K живых существ`. Если строки `world_clock` ещё нет (первый запуск на
чистой БД) — печатается `мир не найден в БД — genesis-запуск`.

**Правило А.7 «время после паузы не догоняется»**: тик — монотонный
внутренний счётчик, не привязанный к реальным часам простоя. Пауза в 10 минут
(рестарт/деплой) или в 10 часов (авария) после восстановления выглядит для
существ одинаково — мир просто продолжает считать со своего тика дальше, без
искусственной перемотки биочасов вперёд.

### Транзиентные обрывы соединения с Postgres

Пул `pg` (`Pool`) во всех трёх долгоживущих процессах (`sim-engine`,
`reflection-worker`, `api-gateway`) слушает событие `error` и логирует его, не
роняя процесс (см. `services/*/pool.ts` / `services/sim-engine/src/
persistence/pool.ts`) — без этого разрыв простаивающего соединения (например,
`docker compose restart postgres`) валил бы процесс необработанным исключением
Node.js. Пул сам переподключается на следующем запросе; sim-engine при этом
просто залогирует ошибку конкретного тика и продолжит со следующего (мир не
останавливается из-за временной недоступности БД).

## 4. Как откатиться (снапшоты и бэкапы)

Два независимых уровня защиты данных (А.7):

1. **Снапшот мира в БД** — каждые `time.snapshot_interval_ticks` тиков (30 =
   ~1 минута при визуальном тике 2с, `config/constants.yaml`). Это не
   отдельный файл, а само состояние таблицы `creatures`/`bonds`/`aversions` —
   восстановление читает его при старте процесса (см. раздел 3 выше). Потеря
   при неожиданном падении — не больше ~1 минуты жизни мира.

2. **pg_dump по расписанию + WAL-архивация** — на случай повреждения самой
   БД (не просто рестарта процесса sim-engine):
   - `ops/backup/pg_dump.sh` — полный дамп (`pg_dump -Fc`) в
     `ops/backup/dumps/` (не коммитится, см. `.gitignore`), ежесуточно по
     `aurwin-backup.timer` (03:15 UTC + случайная задержка до 5 мин).
     Хранит `AURWIN_BACKUP_RETENTION_DAYS` (по умолчанию 14) последних
     дампов, старые удаляет автоматически.
   - WAL-архивация Postgres (`docker-compose.yml`, сервис `postgres`,
     `archive_mode=on`) непрерывно копирует завершённые WAL-сегменты в
     именованный volume `wal_archive` — точка отсчёта для PITR между
     дампами. **Важно**: volume создаётся Docker с владельцем `root:root`,
     а архивирующий процесс Postgres работает от `uid postgres` — поэтому
     `command` сервиса `postgres` сначала делает `chown postgres:postgres
     /wal-archive`, и только потом передаёт управление штатному
     `docker-entrypoint.sh` (без этого шага WAL-архивация тихо (для
     наблюдателя) падает на каждом сегменте с `Permission denied` — это
     реальный дефект, обнаруженный и исправленный в этой фазе, см.
     `DEVIATIONS.md`).
   - Ротация WAL: `ops/backup/prune_wal.sh` удаляет сегменты старше
     `AURWIN_WAL_RETENTION_DAYS` (по умолчанию = dump retention, 14 суток).
     Вызывается из `ops/retention/run.sh` вместе с DB-maintenance
     (`aurwin-retention.timer`). Без prune volume растёт безлимитно.

Запустить бэкап вручную (например, перед рискованной миграцией):

```bash
ops/backup/pg_dump.sh
```

Откатиться на дамп:

```bash
ops/backup/restore.sh ops/backup/dumps/aurwin-<TIMESTAMP>.dump
# или без интерактивного подтверждения (автоматизация):
ops/backup/restore.sh ops/backup/dumps/aurwin-<TIMESTAMP>.dump --yes
```

`restore.sh` **необратимо пересоздаёт базу `aurwin`** (CLAUDE.md, «Незыблемые
правила», п.6 — поэтому обязательное интерактивное подтверждение, если не
передан `--yes`): останавливает `sim-engine`/`reflection-worker`/
`api-gateway`, дропает и создаёт БД заново, восстанавливает дамп через
`pg_restore`, затем поднимает сервисы обратно — `sim-engine` при рестарте
подхватит только что восстановленный снапшот тем же путём, что и обычный
рестарт процесса (раздел 3).

Проверено живым прогоном в этой фазе: `pg_dump.sh` → `restore.sh` тем же
дампом → `sim-engine` поднялся из восстановленного состояния и продолжил
тикать без genesis и без потери существ.

## 5. Ретенция (обслуживание БД)

`ops/retention/run.sh` запускает `runRetentionMaintenance()`
(`services/db/src/maintenance/`) через одноразовый контейнер
`db-maintenance` — вне тикового цикла sim-engine, тем же принципом, что и
LLM-вызовы (7.3: обслуживание не блокирует симуляцию). Затем вызывает
`ops/backup/prune_wal.sh` (ротация WAL-архива). Ежесуточно по
`aurwin-retention.timer` (02:30 UTC + случайная задержка). Что делает:
прунинг/затухание значимости эпизодов, TTL `decision_log`, обнуление
`reflections.request/response`, прореживание `trait_history`, сворачивание
`world_events`/`signals` в суточные агрегаты, очистка транзиентных записей
при смерти существа, удаление старых WAL-сегментов. Пороги DB —
`config/constants.yaml` → секция `retention` (единый источник правды,
CLAUDE.md п.3); порог WAL — `AURWIN_WAL_RETENTION_DAYS` (env, default 14).

Запустить вручную:

```bash
ops/retention/run.sh
```

## 6. Систематические проверки после любого деплоя

```bash
npm test                                    # 29 файлов тестов, зелёный обязателен
docker compose up -d                        # весь стек поднимается без ошибок
docker compose ps                           # все сервисы Up (postgres — Up (healthy))
curl -s http://127.0.0.1:9090/api/v1/targets | grep -o '"health":"[a-z]*"'   # оба job = up
```

## 7. Секреты

`.env` (см. `.env.example`) никогда не коммитится и не логируется. Ключ
Anthropic (`ANTHROPIC_API_KEY`) читается исключительно `reflection-worker` из
окружения и никогда не появляется во фронтенд-коде (CLAUDE.md, «Незыблемые
правила», п.1–2). Пароль Postgres/Grafana — тоже только из `.env`.
