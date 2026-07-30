import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "services/*/tests/**/*.test.ts"],
    globalSetup: ["./tests/setup/global-db-setup.ts"],
    // Тесты схемы БД делают migrate up/down на общем эфемерном контейнере
    // Postgres (см. tests/setup/global-db-setup.ts) — файлы должны идти
    // последовательно, иначе один файл может застать таблицы снесёнными
    // другим файлом посреди прогона down/up.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
