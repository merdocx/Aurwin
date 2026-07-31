#!/usr/bin/env bash
# Последовательный прогон фаз с независимыми гейтами (Приложение Б).
# Использование:  bash ops/build.sh [первая_фаза]   (по умолчанию с 1)
set -euo pipefail
cd /opt/aurwin
mkdir -p ops/reports ops/logs

START="${1:-1}"

for phase in $(seq "$START" 7); do
  echo "=== Фаза $phase — старт $(date '+%F %T') ==="

  claude -p "$(cat ops/phases/phase-${phase}.md)" \
    --allowedTools "Read,Edit,Write,Bash,Grep,Glob" \
    --permission-mode acceptEdits \
    --max-turns 150 \
    --output-format json \
    > "ops/logs/phase-${phase}.json" \
    2> "ops/logs/phase-${phase}.err" || {
      echo "Фаза $phase: агент завершился с ошибкой. Смотри ops/logs/phase-${phase}.err"
      exit 1; }

  cost=$(jq -r '.total_cost_usd // "n/a"' "ops/logs/phase-${phase}.json" 2>/dev/null || echo "n/a")
  echo "Стоимость фазы $phase: \$${cost}"

  # Гейт проверяется независимо от отчёта агента
  if ! npm test; then
    echo "Фаза $phase: гейт не пройден (npm test). Стоп."
    echo "Починить и повторить:  bash ops/build.sh $phase"
    exit 1
  fi

  git add -A && git commit -m "phase ${phase}: complete" || true
  echo "=== Фаза $phase пройдена $(date '+%F %T') ==="
done

echo "Сборка завершена. Отчёты: ops/reports/"
