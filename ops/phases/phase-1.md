Задача: фаза 1 «Каркас» проекта Aurwin.

Прочитай docs/AURWIN_TZ.md, разделы 7.1, 7.5, А.1, А.7, А.9.

Создай:
- структуру репозитория под компоненты А.1 (sim-engine, reflection-worker,
  api-gateway, frontend) в монорепозитории с общим package.json;
- config/constants.yaml — ВСЕ константы из таблицы А.9 с комментариями-обоснованиями;
- docker-compose.yml: postgres (без публикации порта наружу), заготовки сервисов;
- .gitignore, обязательно включающий .env;
- npm test (jest или vitest) — пока с одним smoke-тестом, читающим constants.yaml
  и проверяющим, что все ожидаемые ключи присутствуют;
- README.md с командами запуска;
- git init и первый коммит.

Гейт: `docker compose up -d` поднимает postgres, `npm test` зелёный,
`git status` чист, .env отсутствует в индексе.

По завершении: отчёт в ops/reports/phase-1.md.
