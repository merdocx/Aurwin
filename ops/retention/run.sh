#!/usr/bin/env bash
set -euo pipefail

# Плановый прогон скриптов ретенции (services/db/src/maintenance, ТЗ А.2/А.9)
# через одноразовый контейнер db-maintenance (docker-compose.yml, profiles:
# ["tools"]) — вне тикового цикла sim-engine, тот же принцип "обслуживание
# не блокирует симуляцию", что и для LLM-вызовов (7.3).
#
# Затем prune WAL-архива (ops/backup/prune_wal.sh) — иначе volume wal_archive
# растёт безлимитно (см. ops/DEVIATIONS.md, 2026-08-02).
#
# Запуск: cron/systemd timer раз в сутки — см.
# ops/systemd/aurwin-retention.timer и ops/README.md.

cd "$(dirname "$0")/../.."  # -> корень репозитория (docker-compose.yml)

echo "[retention] прогон runRetentionMaintenance()"
docker compose run --rm db-maintenance npm run maintenance:run --workspace=@aurwin/db
echo "[retention] готово"

echo "[retention] prune WAL archive"
ops/backup/prune_wal.sh
echo "[retention] WAL prune готово"
