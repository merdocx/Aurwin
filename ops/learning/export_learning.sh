#!/usr/bin/env bash
set -euo pipefail

# Экспорт данных обучения в ротируемые NDJSON (episodes, reflections meta,
# decision_log, trait_history, learning_events).
#
# Prod:  AURWIN_LEARNING_EXPORT_DIR=/var/lib/aurwin/exports/learning
# Local: AURWIN_LEARNING_EXPORT_DIR=ops/learning/exports (gitignore)
#
# Запуск из корня репозитория (нужен поднятый docker compose с postgres).

cd "$(dirname "$0")/../.."  # -> корень репозитория

EXPORT_DIR="${AURWIN_LEARNING_EXPORT_DIR:-/var/lib/aurwin/exports/learning}"
RETENTION="${AURWIN_LEARNING_EXPORT_RETENTION:-14}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${EXPORT_DIR}/${TIMESTAMP}"

mkdir -p "${OUT_DIR}"

export_table() {
  local table="$1"
  local sql="$2"
  local out="${OUT_DIR}/${table}.ndjson"
  echo "[learning-export] ${table} -> ${out}"
  docker compose exec -T postgres \
    psql -U aurwin -d aurwin -v ON_ERROR_STOP=1 -At -c "${sql}" > "${out}"
}

# row_to_json → одна JSON-строка на запись (NDJSON).
export_table episodes \
  "COPY (SELECT row_to_json(t) FROM (SELECT id, creature_id, tick, type, participants, significance, consumed_by_reflection, learned_from, transmission_depth, core_memory, created_at FROM episodes) t) TO STDOUT"

export_table reflections \
  "COPY (SELECT row_to_json(t) FROM (SELECT id, creature_id, kind, status, merged_episode_ids, created_at, applied_at FROM reflections) t) TO STDOUT"

export_table decision_log \
  "COPY (SELECT row_to_json(t) FROM (SELECT creature_id, tick, chosen_action, factors, created_at FROM decision_log) t) TO STDOUT"

export_table trait_history \
  "COPY (SELECT row_to_json(t) FROM (SELECT creature_id, tick, traits, source FROM trait_history) t) TO STDOUT"

export_table learning_events \
  "COPY (SELECT row_to_json(t) FROM (SELECT id, tick, creature_id, kind, payload, created_at FROM learning_events) t) TO STDOUT"

# Ротация: удаляем каталоги-экспорты старше RETENTION штук (по имени timestamp).
mapfile -t ALL_EXPORTS < <(find "${EXPORT_DIR}" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)
if ((${#ALL_EXPORTS[@]} > RETENTION)); then
  REMOVE_COUNT=$((${#ALL_EXPORTS[@]} - RETENTION))
  echo "[learning-export] ротация: удаление ${REMOVE_COUNT} старых экспортов (retention=${RETENTION})"
  for ((i = 0; i < REMOVE_COUNT; i++)); do
    rm -rf "${EXPORT_DIR}/${ALL_EXPORTS[$i]}"
  done
fi

echo "[learning-export] готово: ${OUT_DIR}"
ls -lah "${OUT_DIR}"
