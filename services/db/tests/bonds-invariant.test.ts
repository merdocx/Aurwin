import { beforeAll, describe, expect, it } from "vitest";
import { ensureMigratedUp, getTestPool, insertCreature } from "./helpers.js";

describe("инвариант bonds: creature_a < creature_b", () => {
  let lo: string;
  let hi: string;

  beforeAll(async () => {
    await ensureMigratedUp();
    const pool = getTestPool();
    const a = await insertCreature(pool, { name: "А" });
    const b = await insertCreature(pool, { name: "Б" });
    [lo, hi] = a < b ? [a, b] : [b, a];
  });

  it("отвергает вставку с creature_a > creature_b", async () => {
    const pool = getTestPool();
    await expect(
      pool.query(
        `INSERT INTO bonds (creature_a, creature_b, kind, strength) VALUES ($1, $2, 'friend', 0.5)`,
        [hi, lo],
      ),
    ).rejects.toThrow();
  });

  it("принимает вставку с creature_a < creature_b", async () => {
    const pool = getTestPool();
    await expect(
      pool.query(
        `INSERT INTO bonds (creature_a, creature_b, kind, strength) VALUES ($1, $2, 'friend', 0.5)`,
        [lo, hi],
      ),
    ).resolves.toBeDefined();
  });

  it("не позволяет паре попасть в таблицу дважды (PRIMARY KEY)", async () => {
    const pool = getTestPool();
    await expect(
      pool.query(
        `INSERT INTO bonds (creature_a, creature_b, kind, strength) VALUES ($1, $2, 'friend', 0.9)`,
        [lo, hi],
      ),
    ).rejects.toThrow();
  });
});
