import { beforeAll, describe, expect, it } from "vitest";
import { ensureMigratedUp, getTestPool, insertCreature } from "../../db/tests/helpers.js";
import { countRecentEventReflections, findDueBackgroundCandidates, findDueEventCandidates, fetchUnconsumedEpisodes } from "../src/db.js";
import { selectCandidates } from "../src/queue.js";

/** born_at=0 + этот tick → взрослый пингвин (juvenile < 1.5 нед ≈ 64800 тиков при visual_tick=2с). */
const ADULT_TICK = 100_000;

async function ensureAdultWorldTick(pool: ReturnType<typeof getTestPool>, tick = ADULT_TICK): Promise<void> {
  await pool.query(
    `INSERT INTO world_clock (id, tick, phase) VALUES (1, $1, 'day') ON CONFLICT (id) DO UPDATE SET tick = EXCLUDED.tick`,
    [tick],
  );
}

async function insertEpisode(pool: ReturnType<typeof getTestPool>, creatureId: string, type: string, significance = 0.9, createdAt?: string) {
  await pool.query(
    `INSERT INTO episodes (creature_id, tick, type, participants, significance, created_at, decayed_at)
     VALUES ($1, 1, $2, '{}', $3, ${createdAt ? "$4" : "now()"}, now())`,
    createdAt ? [creatureId, type, significance, createdAt] : [creatureId, type, significance],
  );
}

async function insertDummyEventReflection(pool: ReturnType<typeof getTestPool>, creatureId: string) {
  await pool.query(`INSERT INTO reflections (creature_id, kind, status, created_at) VALUES ($1, 'event', 'applied', now())`, [creatureId]);
}

describe("queue.ts: отбор кандидатов (7.3) — дебаунс, слияние, глобальные лимиты", () => {
  beforeAll(async () => {
    await ensureMigratedUp();
  });

  it("findDueEventCandidates: существо с недавней событийной рефлексией НЕ считается due (дебаунс 4ч)", async () => {
    const pool = getTestPool();
    await ensureAdultWorldTick(pool);
    const creatureId = await insertCreature(pool, { species: "penguin" });
    await insertEpisode(pool, creatureId, "friend_died");
    await insertDummyEventReflection(pool, creatureId);

    const due = await findDueEventCandidates(pool);
    expect(due).not.toContain(creatureId);
  });

  it("findDueEventCandidates: без недавней рефлексии и с триггерным эпизодом — due", async () => {
    const pool = getTestPool();
    await ensureAdultWorldTick(pool);
    const creatureId = await insertCreature(pool, { species: "penguin" });
    await insertEpisode(pool, creatureId, "friend_died");

    const due = await findDueEventCandidates(pool);
    expect(due).toContain(creatureId);
  });

  it("findDueEventCandidates: детёныш с триггерным эпизодом НЕ due (7.4 — только фоновая)", async () => {
    const pool = getTestPool();
    await ensureAdultWorldTick(pool, 100); // ageWeeks ≈ 0 → juvenile
    const creatureId = await insertCreature(pool, { species: "penguin" });
    await insertEpisode(pool, creatureId, "friend_died");

    const due = await findDueEventCandidates(pool);
    expect(due).not.toContain(creatureId);
  });

  it("findDueEventCandidates: НЕ триггерный тип эпизода (woken_by_alarm) сам по себе не делает существо due", async () => {
    const pool = getTestPool();
    await ensureAdultWorldTick(pool);
    const creatureId = await insertCreature(pool, { species: "penguin" });
    await insertEpisode(pool, creatureId, "woken_by_alarm", 0.2);

    const due = await findDueEventCandidates(pool);
    expect(due).not.toContain(creatureId);
  });

  it("findDueBackgroundCandidates: спящее существо без недавней фоновой рефлексии — due; бодрствующее — нет", async () => {
    const pool = getTestPool();
    const asleep = await insertCreature(pool, { species: "orca" });
    await pool.query(`UPDATE creatures SET is_asleep = TRUE WHERE id = $1`, [asleep]);
    const awake = await insertCreature(pool, { species: "orca" });

    const due = await findDueBackgroundCandidates(pool);
    expect(due).toContain(asleep);
    expect(due).not.toContain(awake);
  });

  it("selectCandidates: пустой фон (нет unconsumed) — LLM не ставится, interval bookkeeping через discarded", async () => {
    const pool = getTestPool();
    await ensureAdultWorldTick(pool);
    const creatureId = await insertCreature(pool, { species: "penguin" });
    await pool.query(`UPDATE creatures SET is_asleep = TRUE WHERE id = $1`, [creatureId]);

    const selected = await selectCandidates(pool);
    expect(selected.every((s) => s.candidate.creatureId !== creatureId)).toBe(true);

    const row = await pool.query(`SELECT status, kind FROM reflections WHERE creature_id = $1 ORDER BY created_at DESC LIMIT 1`, [creatureId]);
    expect(row.rows[0].kind).toBe("background");
    expect(row.rows[0].status).toBe("discarded");

    // Повторный select не крутит снова (interval bookkeeping).
    const dueAgain = await findDueBackgroundCandidates(pool);
    expect(dueAgain).not.toContain(creatureId);
  });

  it("слияние событий окна: fetchUnconsumedEpisodes отдаёт ВСЕ непоглощённые эпизоды существа, не только триггерный", async () => {
    const pool = getTestPool();
    const creatureId = await insertCreature(pool, { species: "penguin" });
    await insertEpisode(pool, creatureId, "friend_died", 0.9);
    await insertEpisode(pool, creatureId, "bond_formed", 0.3);
    await insertEpisode(pool, creatureId, "woken_by_alarm", 0.2);

    const episodes = await fetchUnconsumedEpisodes(pool, creatureId);
    expect(episodes.map((e) => e.type).sort()).toEqual(["bond_formed", "friend_died", "woken_by_alarm"]);
  });

  it("countRecentEventReflections считает только последние N часов", async () => {
    const pool = getTestPool();
    const creatureId = await insertCreature(pool, { species: "penguin" });
    await pool.query(`INSERT INTO reflections (creature_id, kind, status, created_at) VALUES ($1, 'event', 'applied', now() - interval '2 hours')`, [creatureId]);
    await insertDummyEventReflection(pool, creatureId);

    const lastHour = await countRecentEventReflections(pool, 1);
    const last3Hours = await countRecentEventReflections(pool, 3);
    expect(lastHour).toBeLessThan(last3Hours);
  });

  it("selectCandidates: глобальный часовой лимит (30/час) режет число событийных вызовов, отдавая приоритет дольше всех ждущим", async () => {
    const pool = getTestPool();
    await ensureAdultWorldTick(pool);

    // Другие тесты этого файла уже могли вставить свои строки reflections (общий
    // эфемерный Postgres, без сброса между it()) — считаем ТЕКУЩИЙ расход и
    // добираем фиктивными рефлексиями ровно до (лимит - 2), чтобы бюджет,
    // оставшийся для наших 5 тестовых существ, был предсказуемо равен 2.
    const HOURLY_LIMIT = 30;
    const alreadyUsed = await countRecentEventReflections(pool, 1);
    const limitFiller = await insertCreature(pool, { species: "penguin" });
    const toFill = HOURLY_LIMIT - 2 - alreadyUsed;
    for (let i = 0; i < toFill; i++) await insertDummyEventReflection(pool, limitFiller);

    // 5 существ, каждое с непоглощённым friend_died, эпизоды с разным created_at (для FIFO).
    const creatureIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = await insertCreature(pool, { species: "penguin" });
      creatureIds.push(id);
      await insertEpisode(pool, id, "friend_died", 0.9);
    }
    // created_at для episodes — TIMESTAMPTZ NOT NULL DEFAULT now(); переопределим явно через UPDATE, чтобы гарантировать порядок (самый старый — i=0).
    for (let i = 0; i < creatureIds.length; i++) {
      await pool.query(`UPDATE episodes SET created_at = now() - ($1::text || ' minutes')::interval WHERE creature_id = $2`, [String(5 - i), creatureIds[i]]);
    }

    const selected = await selectCandidates(pool);
    const selectedForOurCreatures = selected.filter((s) => creatureIds.includes(s.candidate.creatureId));
    // Остался бюджет ровно 2 (30 - 28) в часовом окне — суточный лимит (120) не бьёт первым.
    expect(selectedForOurCreatures.length).toBe(2);
    // Приоритет — самым старым ожидающим эпизодам (i=0 и i=1, у которых created_at самый ранний).
    expect(selectedForOurCreatures.map((s) => s.candidate.creatureId)).toEqual([creatureIds[0], creatureIds[1]]);

    // Каждый отобранный кандидат сразу получил строку reflections со статусом 'queued'.
    for (const s of selectedForOurCreatures) {
      const row = await pool.query(`SELECT status, kind FROM reflections WHERE id = $1`, [s.reflectionId]);
      expect(row.rows[0].status).toBe("queued");
      expect(row.rows[0].kind).toBe("event");
    }

    // Этот тест НАМЕРЕННО насыщает ГЛОБАЛЬНЫЙ часовой бюджет event-рефлексий
    // (общий на весь набор тестов — та же таблица reflections, общий эфемерный
    // Postgres) до нулевого остатка (28 filler + 2 отобранных = 30/30). Без
    // очистки этот нулевой остаток переживает сам тест и достаётся ЛЮБОМУ
    // следующему тесту в этом прогоне, которому нужно, чтобы worker.runPass()
    // реально отобрал event-кандидата (например, tests/honesty.test.ts) —
    // такой тест находит хронически пустой бюджет и его кандидат НИКОГДА не
    // отбирается, независимо от того, что он проверяет. Возвращаем счётчик к
    // тому состоянию, в котором его застал этот тест (alreadyUsed), чтобы
    // проверка "лимит режет ровно до 2" не оставляла после себя постоянно
    // нулевой глобальный бюджет для всех остальных файлов.
    await pool.query(`DELETE FROM reflections WHERE creature_id = ANY($1::uuid[])`, [[limitFiller, ...creatureIds]]);
  });
});
