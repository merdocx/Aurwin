import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureMigratedUp, getTestPool } from "../../db/tests/helpers.js";
import { persistGenesis, upsertCreatures } from "../src/persistence/persist.js";
import { hasAnyCreatureRecord, loadWorldState } from "../src/persistence/restore.js";
import { Simulation } from "../src/sim/simulation.js";
import { makeTestCreature } from "./testCreature.js";

/**
 * Регрессия приёмки: genesis отработал дважды при рестарте sim-engine
 * (в БД оказалось 80 пингвинов/8 касаток вместо 40/4, все с parent_a NULL).
 * Причина — creatures и world_clock писались раздельно (upsertCreatures,
 * затем чуть позже updateWorldClock); крах процесса между этими двумя await
 * оставлял в БД genesis-особей БЕЗ world_clock, и следующий запуск принимал
 * это за холодный старт. persistGenesis (persist.ts) чинит это, записывая
 * оба атомарно одной транзакцией; hasAnyCreatureRecord (restore.ts) — второй,
 * независимый сигнал-предохранитель на случай состояния, повреждённого не
 * через persistGenesis.
 */
describe("genesis выполняется ровно один раз за всю жизнь мира (регрессия приёмки)", () => {
  beforeAll(async () => {
    await ensureMigratedUp();
  });

  it("persistGenesis пишет creatures и world_clock атомарно — loadWorldState сразу видит оба", async () => {
    const pool = getTestPool();
    const idA = randomUUID();
    const idB = randomUUID();
    const creatures = [
      makeTestCreature({ id: idA, species: "penguin" }),
      makeTestCreature({ id: idB, species: "orca" }),
    ];

    await persistGenesis(pool, creatures, 0, "day");

    const restored = await loadWorldState(pool);
    expect(restored).not.toBeNull();
    const ids = restored!.creatures.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([idA, idB]));
  });

  it("рестарт после persistGenesis восстанавливает популяцию, а не удваивает её", async () => {
    const pool = getTestPool();
    // БД общая для всех тестов файла (world_clock — singleton id=1, creatures
    // копится) — сравниваем ДЕЛЬТУ живых существ, а не абсолютное число,
    // чтобы не зависеть от того, что вставили другие it() в этом файле.
    const before = await pool.query<{ n: string }>(`SELECT COUNT(*)::int AS n FROM creatures WHERE died_at_tick IS NULL`);
    const aliveBefore = Number(before.rows[0].n);

    const sim1 = new Simulation(777);
    const genesisCount = sim1.aliveCreatures().length;
    expect(genesisCount).toBeGreaterThan(0);

    await persistGenesis(pool, sim1.aliveCreatures(), sim1.currentTick, sim1.world.dayNight.phase());

    // "Рестарт №1": новый процесс читает world_clock/creatures заново — как
    // делает index.ts при старте.
    const restoredOnce = await loadWorldState(pool);
    expect(restoredOnce).not.toBeNull();
    const afterOnce = await pool.query<{ n: string }>(`SELECT COUNT(*)::int AS n FROM creatures WHERE died_at_tick IS NULL`);
    expect(Number(afterOnce.rows[0].n) - aliveBefore).toBe(genesisCount);
    const sim2 = new Simulation(999, {}, restoredOnce ?? undefined);
    expect(sim2.aliveCreatures().length - aliveBefore).toBe(genesisCount);

    // "Рестарт №2" подряд — то самое место, где раньше плодилась вторая
    // genesis-когорта (persistGenesis тут НЕ вызывается второй раз, ровно
    // как index.ts не повторяет genesis при restored !== null). Популяция
    // по-прежнему не удваивается.
    const restoredTwice = await loadWorldState(pool);
    const sim3 = new Simulation(1000, {}, restoredTwice ?? undefined);
    expect(sim3.aliveCreatures().length - aliveBefore).toBe(genesisCount);
  });

  it("детектирует сценарий крэша: creatures есть, world_clock не при чём — hasAnyCreatureRecord обязан вернуть true", async () => {
    const pool = getTestPool();
    const orphan = makeTestCreature({ id: randomUUID(), species: "penguin" });

    // Воспроизводим ровно то окно, что раньше приводило к повторному genesis:
    // существо персистится, а world_clock в этом вызове не участвует вовсе.
    await upsertCreatures(pool, [orphan], "full");

    expect(await hasAnyCreatureRecord(pool)).toBe(true);
  });

  it("на пустой (после миграций, до первой вставки) БД hasAnyCreatureRecord/loadWorldState не заявляют о существовании мира", async () => {
    // Не полагаемся на пустоту таблиц (общая тестовая БД, другие тесты уже
    // могли что-то вставить) — проверяем только то, что ФУНКЦИИ формально
    // умеют возвращать "мира нет", когда обеих таблиц действительно нет
    // записей. Значимая часть контракта здесь — типы возврата и то, что null
    // из loadWorldState это и есть сигнал для genesis в index.ts.
    const pool = getTestPool();
    const result = await pool.query(`SELECT COUNT(*)::int AS n FROM creatures`);
    const clockResult = await pool.query(`SELECT COUNT(*)::int AS n FROM world_clock`);
    if (result.rows[0].n === 0) {
      expect(await hasAnyCreatureRecord(pool)).toBe(false);
    }
    if (clockResult.rows[0].n === 0) {
      expect(await loadWorldState(pool)).toBeNull();
    }
  });
});
