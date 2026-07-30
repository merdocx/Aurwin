import path from "node:path";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");

export interface MigrateOptions {
  databaseUrl: string;
  /** Количество миграций для применения/отката; по умолчанию — все. */
  count?: number;
}

export async function migrateUp(options: MigrateOptions): Promise<void> {
  await runner({
    databaseUrl: options.databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: "up",
    count: options.count ?? Infinity,
    migrationsTable: "pgmigrations",
    log: () => {},
  });
}

export async function migrateDown(options: MigrateOptions): Promise<void> {
  await runner({
    databaseUrl: options.databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: "down",
    count: options.count ?? Infinity,
    migrationsTable: "pgmigrations",
    log: () => {},
  });
}
