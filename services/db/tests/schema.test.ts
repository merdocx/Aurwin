import { beforeAll, describe, expect, it } from "vitest";
import { ensureMigratedUp, getTestPool } from "./helpers.js";

const REQUIRED_TABLES = [
  "creatures",
  "episodes",
  "bonds",
  "aversions",
  "trait_history",
  "perceived_states",
  "perceived_zone_threat",
  "signal_trust",
  "signals",
  "reflections",
  "world_events",
  "decision_log",
];

const CREATURES_COLUMNS = [
  "id",
  "species",
  "name",
  "sex",
  "born_at_tick",
  "died_at_tick",
  "death_cause",
  "parent_a",
  "parent_b",
  "pos_x",
  "pos_y",
  "zone",
  "traits",
  "traits_birth",
  "needs",
  "emotion",
  "intentions",
  "narrative",
  "narrative_facts",
  "skills",
  "chronotype",
  "is_asleep",
  "authority",
  "habits",
  "weights",
  "weights_birth",
  "last_reflection_at",
];

async function columnsOf(table: string): Promise<Set<string>> {
  const pool = getTestPool();
  const result = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return new Set(result.rows.map((row) => row.column_name));
}

async function tableExists(table: string): Promise<boolean> {
  const pool = getTestPool();
  const result = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return (result.rowCount ?? 0) > 0;
}

describe("схема БД (А.2)", () => {
  beforeAll(async () => {
    await ensureMigratedUp();
  });

  it.each(REQUIRED_TABLES)("таблица %s существует после миграций", async (table) => {
    expect(await tableExists(table)).toBe(true);
  });

  it("creatures содержит все обязательные поля из А.2", async () => {
    const columns = await columnsOf("creatures");
    for (const column of CREATURES_COLUMNS) {
      expect(columns.has(column), `ожидалась колонка creatures.${column}`).toBe(true);
    }
  });

  it("episodes содержит learned_from и transmission_depth", async () => {
    const columns = await columnsOf("episodes");
    expect(columns.has("learned_from")).toBe(true);
    expect(columns.has("transmission_depth")).toBe(true);
    expect(columns.has("consumed_by_reflection")).toBe(true);
    expect(columns.has("significance")).toBe(true);
  });

  it("aversions направлены: колонки subject_id/object_id, без канонического порядка", async () => {
    const columns = await columnsOf("aversions");
    expect(columns.has("subject_id")).toBe(true);
    expect(columns.has("object_id")).toBe(true);

    const constraints = await getTestPool().query(
      `
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'aversions'::regclass AND contype = 'c'
      `,
    );
    expect(constraints.rowCount).toBe(0);
  });

  it("bonds имеет CHECK-инвариант creature_a < creature_b", async () => {
    const result = await getTestPool().query(
      `
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'bonds'::regclass AND contype = 'c'
      `,
    );
    expect(result.rows.some((row) => row.def.includes("creature_a") && row.def.includes("creature_b"))).toBe(true);
  });

  it("signals содержит true_state/claimed_state/outcome", async () => {
    const columns = await columnsOf("signals");
    for (const column of ["true_state", "claimed_state", "outcome", "receivers"]) {
      expect(columns.has(column)).toBe(true);
    }
  });

  it("reflections содержит request/response/merged_episode_ids", async () => {
    const columns = await columnsOf("reflections");
    for (const column of ["request", "response", "merged_episode_ids", "created_at", "applied_at"]) {
      expect(columns.has(column)).toBe(true);
    }
  });
});
