#!/usr/bin/env bash
set -euo pipefail

# Автоудаление старых WAL-сегментов из volume wal_archive (ТЗ А.7).
# Архив растёт без prune (~16 MB/сегмент); без ротации диск забивается.
# По умолчанию храним столько же суток, сколько pg_dump (14).
#
# Вызывается из ops/retention/run.sh (aurwin-retention.timer) и может
# запускаться вручную. Не трогает pgdata — только /wal-archive.

cd "$(dirname "$0")/../.."  # -> корень репозитория

RETENTION_DAYS="${AURWIN_WAL_RETENTION_DAYS:-${AURWIN_BACKUP_RETENTION_DAYS:-14}}"

echo "[wal-prune] удаление сегментов старше ${RETENTION_DAYS} суток из wal_archive"
BEFORE="$(docker compose exec -T postgres sh -c 'du -sk /wal-archive | cut -f1' 2>/dev/null || echo 0)"
COUNT="$(docker compose exec -T postgres sh -c \
  "find /wal-archive -type f -mtime +${RETENTION_DAYS} -print | wc -l" 2>/dev/null | tr -d '[:space:]')"
COUNT="${COUNT:-0}"

if [[ "${COUNT}" -gt 0 ]]; then
  docker compose exec -T postgres sh -c \
    "find /wal-archive -type f -mtime +${RETENTION_DAYS} -delete"
fi

AFTER="$(docker compose exec -T postgres sh -c 'du -sk /wal-archive | cut -f1' 2>/dev/null || echo 0)"
echo "[wal-prune] удалено файлов: ${COUNT}; размер ${BEFORE}k → ${AFTER}k"
