import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureMigratedUp, getTestPool, insertCreature } from "../../db/tests/helpers.js";
import { applyReflectionResult, applyTraitDeltas, applyWeightDeltas } from "../src/apply.js";
import type { ValidatedReflection } from "../src/validate.js";

const TRAITS = { courage: 0, curiosity: 0, sociability: 0, aggression: 0, caution: 0, expressiveness: 0 };

function fixture(): ValidatedReflection {
  return {
    narrative: "Я продолжаю жить своей жизнью.",
    narrativeFacts: ["Пережил(а) день"],
    traitDeltas: {},
    weightDeltas: {},
    intentions: [],
  };
}

describe("apply.ts: чистая математика дельт (clamp + пожизненный коридор, А.3 шаг 1, 7.7 механизм 4)", () => {
  it("clamp ограничивает дельту черты за ОДНУ рефлексию, даже если LLM попросила больше", () => {
    const result = applyTraitDeltas(TRAITS, TRAITS, { courage: 5 }, 0.1, 0.6);
    expect(result.courage).toBeCloseTo(0.1, 6);
  });

  it("пожизненный коридор не даёт черте уйти за ±corridor от traits_birth даже за много применений", () => {
    let traits = { ...TRAITS };
    const birth = { ...TRAITS };
    for (let i = 0; i < 100; i++) traits = applyTraitDeltas(traits, birth, { courage: 1 }, 0.1, 0.6);
    expect(traits.courage).toBeLessThanOrEqual(birth.courage + 0.6 + 1e-9);
  });

  it("не трогает черты, для которых не пришла дельта", () => {
    const result = applyTraitDeltas({ ...TRAITS, curiosity: 0.4 }, TRAITS, { courage: 0.05 }, 0.1, 0.6);
    expect(result.curiosity).toBe(0.4);
  });

  it("дельта веса ограничена ±weight_delta_clamp и коридором ±weight_lifetime_corridor от weights_birth", () => {
    const weights = { w_trait: 0.5, w_need: { hunger: 1, energy: 1, social: 0.6, sleep: 1 } };
    const weightsBirth = structuredClone(weights);
    let current = weights;
    for (let i = 0; i < 100; i++) current = applyWeightDeltas(current, weightsBirth, { "w_need.hunger": 1 }, 0.05, 0.3);
    expect((current.w_need as any).hunger).toBeLessThanOrEqual((weightsBirth.w_need as any).hunger + 0.3 + 1e-9);
  });

  it("одна дельта веса не превышает clamp за один вызов", () => {
    const weights = { w_trait: 0.5, w_need: { hunger: 1, energy: 1, social: 0.6, sleep: 1 } };
    const weightsBirth = structuredClone(weights);
    const result = applyWeightDeltas(weights, weightsBirth, { w_trait: 10 }, 0.05, 0.3);
    expect(result.w_trait).toBeCloseTo(0.55, 6);
  });
});

describe("apply.ts: применение к Postgres — discard при смерти существа (7.3, «висящая» рефлексия)", () => {
  beforeAll(async () => {
    await ensureMigratedUp();
  });

  it("существо ЖИВО: дельты применяются, narrative/intentions заменяются, reflections.status = 'applied'", async () => {
    const pool = getTestPool();
    const creatureId = await insertCreature(pool, { species: "penguin" });
    const reflection = await pool.query(`INSERT INTO reflections (creature_id, kind, status) VALUES ($1, 'event', 'queued') RETURNING id`, [creatureId]);
    const reflectionId = reflection.rows[0].id;

    const validated = fixture();
    validated.traitDeltas = { courage: 0.08 };
    const outcome = await applyReflectionResult(pool, {
      reflectionId,
      creatureId,
      mergedEpisodeIds: [],
      currentTick: 123,
      validated,
    });

    expect(outcome.applied).toBe(true);
    const row = await pool.query(`SELECT traits, narrative, last_reflection_at FROM creatures WHERE id = $1`, [creatureId]);
    expect(row.rows[0].traits.courage).toBeCloseTo(0.08, 6);
    expect(row.rows[0].narrative).toBe(validated.narrative);
    expect(Number(row.rows[0].last_reflection_at)).toBe(123);

    const reflectionRow = await pool.query(`SELECT status FROM reflections WHERE id = $1`, [reflectionId]);
    expect(reflectionRow.rows[0].status).toBe("applied");
  });

  it("существо УМЕРЛО между отправкой запроса и ответом: результат отбрасывается, но narrative сохраняется как «последняя мысль»", async () => {
    const pool = getTestPool();
    const creatureId = await insertCreature(pool, { species: "penguin" });
    await pool.query(`UPDATE creatures SET died_at_tick = 50, death_cause = 'predation' WHERE id = $1`, [creatureId]);
    const beforeTraits = (await pool.query(`SELECT traits FROM creatures WHERE id = $1`, [creatureId])).rows[0].traits;

    const reflection = await pool.query(`INSERT INTO reflections (creature_id, kind, status) VALUES ($1, 'background', 'queued') RETURNING id`, [creatureId]);
    const reflectionId = reflection.rows[0].id;

    const validated = fixture();
    validated.narrative = "Последняя мысль умирающего существа.";
    validated.traitDeltas = { courage: 0.09 };
    const outcome = await applyReflectionResult(pool, {
      reflectionId,
      creatureId,
      mergedEpisodeIds: [],
      currentTick: 200,
      validated,
    });

    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe("creature_dead");

    // Дельты НЕ применены — traits не изменились.
    const afterTraits = (await pool.query(`SELECT traits FROM creatures WHERE id = $1`, [creatureId])).rows[0].traits;
    expect(afterTraits).toEqual(beforeTraits);

    const reflectionRow = await pool.query(`SELECT status FROM reflections WHERE id = $1`, [reflectionId]);
    expect(reflectionRow.rows[0].status).toBe("discarded");

    const lastThought = await pool.query(`SELECT payload FROM world_events WHERE actor_id = $1 AND type = 'last_thought'`, [creatureId]);
    expect(lastThought.rowCount).toBe(1);
    expect(lastThought.rows[0].payload.text).toBe(validated.narrative);
  });

  it("несуществующий creature_id: тоже discard, без падения", async () => {
    const pool = getTestPool();
    const fakeId = randomUUID();
    const reflection = await pool.query(`INSERT INTO reflections (creature_id, kind, status) VALUES ($1, 'event', 'queued') RETURNING id`, [
      await insertCreature(pool),
    ]);
    // Подменяем creature_id на несуществующий ПОСЛЕ вставки строки reflections (FK на creature_id самой reflections не критичен для теста apply — apply читает creatures напрямую).
    const outcome = await applyReflectionResult(pool, {
      reflectionId: reflection.rows[0].id,
      creatureId: fakeId,
      mergedEpisodeIds: [],
      currentTick: 1,
      validated: fixture(),
    });
    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toBe("creature_not_found");
  });
});
