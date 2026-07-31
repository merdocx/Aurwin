#!/usr/bin/env bash
cd /opt/aurwin
echo "=== агент ==="
if pgrep -f "claude -p" >/dev/null; then
  ps -o etime= -p "$(pgrep -f 'claude -p' | head -1)" | xargs echo "работает, время:"
else
  echo "НЕ РАБОТАЕТ"
fi

echo; echo "=== последнее из build.log ==="
grep -E "^=== Фаза" ops/logs/build.log | tail -3

echo; echo "=== инструмент прогона ==="
grep -q '"simulate"' package.json && echo "npm run simulate: есть" || echo "npm run simulate: ЕЩЁ НЕТ"

echo; echo "=== балансировка ==="
lines=$(grep -c . ops/BALANCE_LOG.md 2>/dev/null || echo 0)
echo "строк в BALANCE_LOG.md: $lines"
tail -5 ops/BALANCE_LOG.md 2>/dev/null

echo; echo "=== активность за 10 мин ==="
find . -newermt "-10 minutes" -type f \
  -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/ops/logs/*" \
  | head -10

echo; echo "=== отчёты ==="
ls -1 ops/reports/
