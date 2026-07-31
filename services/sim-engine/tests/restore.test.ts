import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureMigratedUp, getTestPool } from "../../db/tests/helpers.js";
import { syncAversions, syncBonds, updateWorldClock, upsertCreatures } from "../src/persistence/persist.js";
import { loadWorldState } from "../src/persistence/restore.js";
import { makeTestCreature } from "./testCreature.js";

/**
 * Round-trip персистентности (А.7, фаза 7 «Эксплуатация»): то, что
 * upsertCreatures/syncBonds/syncAversions/updateWorldClock записали, должно
 * прочитаться обратно loadWorldState как эквивалентное состояние мира — это
 * ровно то, на чём строится восстановление sim-engine после рестарта
 * (см. services/sim-engine/tests/simulationRestore.test.ts для проверки со
 * стороны Simulation).
 */
describe("persistence: восстановление снапшота из Postgres (А.7)", () => {
  beforeAll(async () => {
    await ensureMigratedUp();
  });

  it("loadWorldState реконструирует тик/фазу/существ/bonds/aversions", async () => {
    const pool = getTestPool();
    const idA = randomUUID();
    const idB = randomUUID();
    const [lo, hi] = idA < idB ? [idA, idB] : [idB, idA];

    const creatureA = makeTestCreature({ id: idA, species: "penguin", pos: { x: 200, y: 200 } });
    const creatureB = makeTestCreature({ id: idB, species: "penguin", pos: { x: 210, y: 200 } });

    await upsertCreatures(pool, [creatureA, creatureB], "full");
    await syncBonds(pool, [{ creatureA: lo, creatureB: hi, kind: "friend", strength: 0.62 }]);
    await syncAversions(pool, [{ subjectId: idA, objectId: idB, strength: 0.4 }]);
    await updateWorldClock(pool, 4242, "night");

    const restored = await loadWorldState(pool);
    expect(restored).not.toBeNull();
    expect(restored!.tick).toBe(4242);
    expect(restored!.phase).toBe("night");

    const restoredIds = restored!.creatures.map((c) => c.id);
    expect(restoredIds).toEqual(expect.arrayContaining([idA, idB]));

    const restoredA = restored!.creatures.find((c) => c.id === idA)!;
    expect(restoredA.species).toBe("penguin");
    expect(restoredA.pos).toEqual({ x: 200, y: 200 });
    expect(restoredA.traits).toEqual(creatureA.traits);
    expect(restoredA.skills).toEqual(creatureA.skills);

    expect(restored!.bonds).toContainEqual({ creatureA: lo, creatureB: hi, kind: "friend", strength: 0.62 });
    expect(restored!.aversions).toContainEqual({ subjectId: idA, objectId: idB, strength: 0.4 });
  });

  it("умершие (died_at_tick заполнен) не попадают в восстановленную популяцию", async () => {
    const pool = getTestPool();
    const aliveId = randomUUID();
    const deadId = randomUUID();
    const alive = makeTestCreature({ id: aliveId, species: "orca" });
    const dead = makeTestCreature({ id: deadId, species: "orca" });

    await upsertCreatures(pool, [alive, dead], "full");
    await pool.query(`UPDATE creatures SET died_at_tick = 10, death_cause = 'age' WHERE id = $1`, [deadId]);
    await updateWorldClock(pool, 100, "day");

    const restored = await loadWorldState(pool);
    const ids = restored!.creatures.map((c) => c.id);
    expect(ids).toContain(aliveId);
    expect(ids).not.toContain(deadId);
  });
});
