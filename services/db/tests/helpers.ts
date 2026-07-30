import { Pool } from "pg";
import { migrateUp, migrateDown } from "../src/migrate.js";

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL не задан. Тесты services/db полагаются на глобальный " +
        "эфемерный Postgres из tests/setup/global-db-setup.ts.",
    );
  }
  return url;
}

export async function ensureMigratedUp(): Promise<void> {
  await migrateUp({ databaseUrl: getDatabaseUrl() });
}

export async function migrateAllDown(): Promise<void> {
  await migrateDown({ databaseUrl: getDatabaseUrl(), count: Infinity });
}

let sharedPool: Pool | undefined;

export function getTestPool(): Pool {
  if (!sharedPool) {
    sharedPool = new Pool({ connectionString: getDatabaseUrl() });
  }
  return sharedPool;
}

interface CreatureOverrides {
  species?: "penguin" | "orca";
  name?: string;
  sex?: "m" | "f";
  bornAtTick?: number;
  diedAtTick?: number | null;
  /** Если задано — died_at ставится в (now() - N дней), существо считается умершим N дней назад. */
  diedAtDaysAgo?: number;
}

/** Вставляет минимально валидное существо и возвращает его id. Для фикстур тестов. */
export async function insertCreature(pool: Pool, overrides: CreatureOverrides = {}): Promise<string> {
  const species = overrides.species ?? "penguin";
  const name = overrides.name ?? "Тестовый";
  const sex = overrides.sex ?? "m";
  const bornAtTick = overrides.bornAtTick ?? 0;
  const traits = { courage: 0, curiosity: 0, sociability: 0, aggression: 0, caution: 0, expressiveness: 0 };
  const needs = { hunger: 0.5, energy: 0.5, social: 0.5, sleep_pressure: 0 };
  const emotion = { valence: 0, arousal: 0 };
  const skills = { foraging: 0, evasion: 0, socializing: 0, hunting: 0, parenting: 0 };
  const weights = { w_need: 1, w_trait: 1, w_skill: 1, w_habit: 1 };

  const result = await pool.query(
    `
    INSERT INTO creatures (
      species, name, sex, born_at_tick, died_at_tick,
      died_at, traits, traits_birth, needs, emotion, skills, chronotype, weights, weights_birth
    ) VALUES (
      $1, $2, $3, $4, $5,
      CASE WHEN $6::float8 IS NULL THEN NULL ELSE now() - ($6::text || ' days')::interval END,
      $7, $7, $8, $9, $10, 0, $11, $11
    )
    RETURNING id
    `,
    [
      species,
      name,
      sex,
      bornAtTick,
      overrides.diedAtTick ?? null,
      overrides.diedAtDaysAgo ?? null,
      JSON.stringify(traits),
      JSON.stringify(needs),
      JSON.stringify(emotion),
      JSON.stringify(skills),
      JSON.stringify(weights),
    ],
  );
  return result.rows[0].id as string;
}
