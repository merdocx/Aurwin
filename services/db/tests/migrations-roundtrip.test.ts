import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureMigratedUp, getTestPool, migrateAllDown } from "./helpers.js";

async function tableExists(table: string): Promise<boolean> {
  const pool = getTestPool();
  const result = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return (result.rowCount ?? 0) > 0;
}

describe("миграции применяются и откатываются", () => {
  beforeAll(async () => {
    await ensureMigratedUp();
  });

  // Восстанавливаем полностью применённую схему после этого теста, чтобы не
  // сломать другие тестовые файлы (vitest.config.ts: fileParallelism: false,
  // файлы идут последовательно, но порядок между ними не гарантирован).
  afterAll(async () => {
    await ensureMigratedUp();
  });

  it("down откатывает всю схему, up применяет её заново", async () => {
    expect(await tableExists("creatures")).toBe(true);

    await migrateAllDown();
    expect(await tableExists("creatures")).toBe(false);
    expect(await tableExists("bonds")).toBe(false);
    expect(await tableExists("decision_log")).toBe(false);

    await ensureMigratedUp();
    expect(await tableExists("creatures")).toBe(true);
    expect(await tableExists("bonds")).toBe(true);
    expect(await tableExists("decision_log")).toBe(true);
  });
});
