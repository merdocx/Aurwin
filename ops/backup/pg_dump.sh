#!/usr/bin/env bash
set -euo pipefail

# Плановый pg_dump (ТЗ А.7, фаза 7 «Эксплуатация»). Дамп в формате custom
# (-Fc) даёт быстрый путь отката к известной точке; вместе с WAL-архивацией
# (docker-compose.yml, сервис postgres) закрывает требование
# "бэкапы Postgres (pg_dump по расписанию + WAL-архивация)".
#
# Запуск: cron/systemd timer раз в сутки — см. ops/systemd/aurwin-backup.timer
# и ops/README.md. Хранит AURWIN_BACKUP_RETENTION_DAYS последних дампов.

cd "$(dirname "$0")/../.."  # -> корень репозитория (docker-compose.yml)

BACKUP_DIR="${AURWIN_BACKUP_DIR:-$(pwd)/ops/backup/dumps}"
RETENTION_DAYS="${AURWIN_BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="${BACKUP_DIR}/aurwin-${TIMESTAMP}.dump"

mkdir -p "${BACKUP_DIR}"

echo "[backup] pg_dump -> ${OUT_FILE}"
docker compose exec -T postgres pg_dump -U aurwin -Fc aurwin > "${OUT_FILE}"

echo "[backup] ротация: удаление дампов старше ${RETENTION_DAYS} суток из ${BACKUP_DIR}"
find "${BACKUP_DIR}" -name 'aurwin-*.dump' -mtime "+${RETENTION_DAYS}" -delete

echo "[backup] готово: $(du -h "${OUT_FILE}" | cut -f1)"
