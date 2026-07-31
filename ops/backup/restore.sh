#!/usr/bin/env bash
set -euo pipefail

# Восстановление из pg_dump (ТЗ А.7; гейт фазы 7: "бэкап... восстанавливается").
#
# ВНИМАНИЕ: пересоздаёт содержимое базы aurwin — необратимая операция.
# CLAUDE.md, «Незыблемые правила», п.6: "не удалять и не пересоздавать БД
# без явного указания" — интерактивное подтверждение ниже и есть то явное
# указание (даётся оператором вручную при запуске, не автоматикой).
#
# Использование: ops/backup/restore.sh <путь-к-дампу> [--yes]

DUMP_FILE="${1:?Использование: ops/backup/restore.sh <путь-к-дампу> [--yes]}"
AUTO_CONFIRM="${2:-}"
cd "$(dirname "$0")/../.."  # -> корень репозитория (docker-compose.yml)

if [ ! -f "${DUMP_FILE}" ]; then
  echo "Файл дампа не найден: ${DUMP_FILE}" >&2
  exit 1
fi

if [ "${AUTO_CONFIRM}" != "--yes" ]; then
  read -r -p "Это ПЕРЕЗАПИШЕТ текущую базу aurwin данными из ${DUMP_FILE}. Продолжить? [y/N] " confirm
  if [ "${confirm}" != "y" ] && [ "${confirm}" != "Y" ]; then
    echo "Отменено."
    exit 1
  fi
fi

echo "[restore] останавливаю писателей/читателей (sim-engine, reflection-worker, api-gateway) на время восстановления"
docker compose stop sim-engine reflection-worker api-gateway

echo "[restore] пересоздаю базу aurwin"
docker compose exec -T postgres psql -U aurwin -d postgres -c "DROP DATABASE IF EXISTS aurwin WITH (FORCE);"
docker compose exec -T postgres psql -U aurwin -d postgres -c "CREATE DATABASE aurwin OWNER aurwin;"

echo "[restore] восстанавливаю из ${DUMP_FILE}"
docker compose exec -T postgres pg_restore -U aurwin -d aurwin --no-owner < "${DUMP_FILE}"

echo "[restore] возвращаю сервисы (sim-engine поднимется из только что восстановленного снапшота — А.7)"
docker compose start sim-engine reflection-worker api-gateway

echo "[restore] готово"
