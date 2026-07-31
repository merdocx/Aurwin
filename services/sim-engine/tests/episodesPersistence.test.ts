import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureMigratedUp, getTestPool, insertCreature } from "../../db/tests/helpers.js";
import { insertEpisodes } from "../src/persistence/persist.js";
import { Simulation } from "../src/sim/simulation.js";
import { makeTestCreature } from "./testCreature.js";

/**
 * Фаза 6: episodes раньше жили ТОЛЬКО в памяти процесса (creature.episodes) —
 * ни одного INSERT в таблицу `episodes` не происходило ни в одной фазе.
 * Без этого событийная рефлексия (reflection-worker) не могла бы найти ни
 * одного триггера в реально работающем стеке (см. ops/DEVIATIONS.md, фаза 6).
 */
describe("Simulation.drainNewEpisodes() + insertEpisodes: персистентность эпизодической памяти (А.2, фаза 6)", () => {
  it("взросление (matured) кладёт эпизод в буфер drainNewEpisodes, а не только в creature.episodes", () => {
    const sim = new Simulation(1, {}, { tick: 0, creatures: [], bonds: [], aversions: [] });
    expect(sim.drainNewEpisodes()).toHaveLength(0);

    // bornAtTick подобран так, чтобы к моменту tick() возраст попал в диапазон
    // "adult" (1.5-7 внутренних недель у пингвина, life_stages.penguin_weeks) —
    // переход juvenile -> adult порождает эпизод "matured" (А.3, шаг 3).
    const juvenile = makeTestCreature({ id: "j1", species: "penguin", ageStage: "juvenile", bornAtTick: -129_600 });
    sim.creatures.set(juvenile.id, juvenile);

    sim.tick();

    const drained = sim.drainNewEpisodes();
    expect(drained.some((e) => e.type === "matured" && e.creatureId === "j1")).toBe(true);
    // Второй drain сразу после первого — буфер уже пуст (не накапливается бесконечно).
    expect(sim.drainNewEpisodes()).toHaveLength(0);
  });

  beforeAll(async () => {
    await ensureMigratedUp();
  });

  it("insertEpisodes пишет эпизод в Postgres так, что его можно прочитать обратно", async () => {
    const pool = getTestPool();
    const creatureId = await insertCreature(pool, { species: "penguin" });
    const episodeId = randomUUID();

    await insertEpisodes(pool, [
      {
        id: episodeId,
        creatureId,
        tick: 42,
        type: "hunt_success",
        participants: [],
        significance: 0.5,
        consumedByReflection: false,
        transmissionDepth: 0,
        coreMemory: false,
        zone: "north_bay",
      },
    ]);

    const result = await pool.query(`SELECT * FROM episodes WHERE id = $1`, [episodeId]);
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].creature_id).toBe(creatureId);
    expect(result.rows[0].type).toBe("hunt_success");
    expect(result.rows[0].significance).toBeCloseTo(0.5, 6);
  });

  it("insertEpisodes — no-op на пустом массиве (не роняет пустой INSERT)", async () => {
    const pool = getTestPool();
    await expect(insertEpisodes(pool, [])).resolves.toBeUndefined();
  });
});
