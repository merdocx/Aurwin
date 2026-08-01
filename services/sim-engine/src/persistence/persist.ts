import type { Pool } from "pg";
import type { AversionRecord, BondRecord, Creature, DecisionLogEntry, Episode, SignalRecord, WorldEvent } from "../sim/types.js";

/**
 * Персистентность sim-engine (А.3, шаги 13-14; ops/DEVIATIONS.md, фаза 5).
 *
 * Две частоты записи creatures, обе используют ОДИН и тот же полный набор
 * колонок для VALUES (значения и так уже в памяти — дёшево сериализовать
 * JSONB целиком), но РАЗНЫЙ набор колонок в ON CONFLICT DO UPDATE:
 *   - "light" (каждый тик, ~2 сек): только позиция/зона/эмоция/сон/activity —
 *     UPDATE через VALUES без INSERT (новорождённые — full snapshot/genesis).
 *   - "full" (раз в time.snapshot_interval_ticks, ~30 тиков/1 мин, А.9
 *     "Снапшот в БД"): все столбцы, включая тяжёлые JSONB (narrative,
 *     weights, habits, intentions) — устойчивость к рестарту (6.1).
 * Так INSERT новой строки (genesis/новорождённый) всегда полноценен вне
 * зависимости от режима, а частая запись остаётся дешёвой.
 */

/** PostgreSQL `real` (float4): denormal/underflow в тексте падает с 22003. */
function toPgReal(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const abs = Math.abs(n);
  if (abs !== 0 && abs < 1e-37) return 0;
  if (abs > 3.4e38) return Math.sign(n) * 3.4e38;
  return n;
}

const FULL_COLUMNS = [
  "id",
  "species",
  "name",
  "sex",
  "born_at_tick",
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
  "activity",
  "authority",
  "habits",
  "weights",
  "weights_birth",
  "last_reflection_at",
  "last_reproduced_at_tick",
  "continuous_starvation_real_hours",
] as const;

const LIGHT_UPSERT_COLUMNS = [
  "id",
  "pos_x",
  "pos_y",
  "zone",
  "emotion",
  "is_asleep",
  "activity",
  "needs",
  "skills",
  "authority",
  "continuous_starvation_real_hours",
] as const;

/**
 * Колонки, которые reflection-worker (фаза 6) применяет НАПРЯМУЮ в Postgres
 * (services/reflection-worker/src/apply.ts) — traits/weights/narrative/
 * narrative_facts/intentions/last_reflection_at. sim-engine держит in-memory
 * копию; reflection-worker пишет в Postgres, sim-engine перечитывает через
 * reloadReflectionFields (persistence/reloadReflection.ts) раз в
 * snapshot_interval_ticks. Полный upsert не затирает эти колонки (см. ниже).
 *
 * Если бы полный периодический снапшот (раз в snapshot_interval_ticks)
 * продолжал перезаписывать ЭТИ колонки из своей (потенциально устаревшей)
 * in-memory копии, он бы затирал результат reflection-worker в течение
 * ближайшей минуты после применения — единственный писатель этих полей
 * должен быть один. Поэтому полный снапшот исключает их из SET-части
 * ON CONFLICT (но НЕ из списка INSERT — новорождённое/genesis-существо
 * обязано получить свои стартовые значения при первой вставке строки).
 */
const REFLECTION_OWNED_COLUMNS = new Set(["traits", "weights", "narrative", "narrative_facts", "intentions", "last_reflection_at"]);

function creatureRowValues(c: Creature): unknown[] {
  return [
    c.id,
    c.species,
    c.name,
    c.sex,
    c.bornAtTick,
    c.parentA ?? null,
    c.parentB ?? null,
    toPgReal(c.pos.x),
    toPgReal(c.pos.y),
    c.zone,
    JSON.stringify(c.traits),
    JSON.stringify(c.traitsBirth),
    JSON.stringify(c.needs),
    JSON.stringify(c.emotion),
    JSON.stringify(c.intentions),
    c.narrative ?? null,
    JSON.stringify(c.narrativeFacts),
    JSON.stringify(c.skills),
    c.chronotype,
    c.isAsleep,
    c.activity ?? "idle",
    toPgReal(c.authority),
    JSON.stringify(c.habits),
    JSON.stringify(c.weights),
    JSON.stringify(c.weightsBirth),
    c.lastReflectionAt,
    c.lastReproducedAtTick ?? null,
    toPgReal(c.continuousStarvationRealHours),
  ];
}

/** Только для ЖИВЫХ существ (сравни с applyDeaths ниже) — вызывающая сторона гарантирует это (index.ts). */
export async function upsertCreatures(pool: Pool, creatures: Creature[], mode: "light" | "full"): Promise<void> {
  if (creatures.length === 0) return;

  if (mode === "light") {
    const values: unknown[] = [];
    const rowPlaceholders: string[] = [];
    for (const creature of creatures) {
      const row = [
        creature.id,
        toPgReal(creature.pos.x),
        toPgReal(creature.pos.y),
        creature.zone,
        JSON.stringify(creature.emotion),
        creature.isAsleep,
        creature.activity ?? "idle",
        JSON.stringify(creature.needs),
        JSON.stringify(creature.skills),
        toPgReal(creature.authority),
        toPgReal(creature.continuousStarvationRealHours),
      ];
      const base = values.length;
      rowPlaceholders.push(
        `($${base + 1}::uuid, $${base + 2}::real, $${base + 3}::real, $${base + 4}::text, $${base + 5}::jsonb, $${base + 6}::boolean, $${base + 7}::text, $${base + 8}::jsonb, $${base + 9}::jsonb, $${base + 10}::real, $${base + 11}::real)`,
      );
      values.push(...row);
    }
    await pool.query(
      `UPDATE creatures AS c SET
        pos_x = v.pos_x,
        pos_y = v.pos_y,
        zone = v.zone,
        emotion = v.emotion,
        is_asleep = v.is_asleep,
        activity = v.activity,
        needs = v.needs,
        skills = v.skills,
        authority = v.authority,
        continuous_starvation_real_hours = v.continuous_starvation_real_hours
      FROM (VALUES ${rowPlaceholders.join(", ")}) AS v(${LIGHT_UPSERT_COLUMNS.join(", ")})
      WHERE c.id = v.id`,
      values,
    );
    return;
  }

  const updateCols = FULL_COLUMNS.filter((c) => c !== "id" && !REFLECTION_OWNED_COLUMNS.has(c));
  const setClause = updateCols.map((c) => `${c} = EXCLUDED.${c}`).join(", ");

  const values: unknown[] = [];
  const rowPlaceholders: string[] = [];
  for (const creature of creatures) {
    const row = creatureRowValues(creature);
    const base = values.length;
    rowPlaceholders.push(`(${row.map((_, j) => `$${base + j + 1}`).join(", ")})`);
    values.push(...row);
  }

  await pool.query(
    `INSERT INTO creatures (${FULL_COLUMNS.join(", ")}) VALUES ${rowPlaceholders.join(", ")} ` +
      `ON CONFLICT (id) DO UPDATE SET ${setClause}`,
    values,
  );
  // Новорождённые попадают в БД на full-снапшоте — birth-строка trait_history
  // идемпотентна (NOT EXISTS), чтобы повторные full-upsert не плодили дубли.
  await ensureTraitHistoryBirths(pool, creatures);
}

/**
 * Запись стартовых черт в trait_history (source=birth, А.2). Идемпотентно:
 * повторный вызов для той же особи не создаёт вторую birth-строку.
 */
export async function ensureTraitHistoryBirths(pool: Pool, creatures: Creature[]): Promise<void> {
  if (creatures.length === 0) return;
  const values: unknown[] = [];
  const rowPlaceholders: string[] = [];
  for (const creature of creatures) {
    const base = values.length;
    rowPlaceholders.push(`($${base + 1}::uuid, $${base + 2}::bigint, $${base + 3}::jsonb)`);
    values.push(creature.id, creature.bornAtTick, JSON.stringify(creature.traitsBirth));
  }
  await pool.query(
    `INSERT INTO trait_history (creature_id, tick, traits, source)
     SELECT v.creature_id, v.tick, v.traits, 'birth'
     FROM (VALUES ${rowPlaceholders.join(", ")}) AS v(creature_id, tick, traits)
     WHERE NOT EXISTS (
       SELECT 1 FROM trait_history th
       WHERE th.creature_id = v.creature_id AND th.source = 'birth'
     )`,
    values,
  );
}

export interface DeathRecord {
  id: string;
  cause: "age" | "starvation" | "predation";
  tick: number;
}

/**
 * Смерть фиксируется отдельным немедленным UPDATE, а не через upsertCreatures:
 * killCreature() удаляет существо из sim.creatures ДО того, как index.ts
 * успевает пройтись по живой популяции — умерший больше не встретится в
 * общем цикле upsertCreatures, поэтому died_at/death_cause применяются
 * точечно, по буферу world_events типа "death" (см. index.ts).
 */
export async function applyDeaths(pool: Pool, deaths: DeathRecord[]): Promise<void> {
  for (const { id, cause, tick } of deaths) {
    await pool.query(`UPDATE creatures SET died_at_tick = $2, death_cause = $3, died_at = now() WHERE id = $1`, [id, tick, cause]);
  }
}

/**
 * Персистентность эпизодической памяти (А.2, `episodes`) — добавлено в фазе 6:
 * до этого эпизоды жили только в памяти процесса (`creature.episodes`), и
 * событийная рефлексия (reflection-worker) не могла бы найти ни одного
 * триггера в реально работающем стеке (см. ops/DEVIATIONS.md, фаза 6).
 * `zone` НЕ пишется — А.2 не содержит эту колонку в схеме `episodes` (это
 * внутреннее поле sim-engine для memory.ts, дублирующее информацию, уже
 * доступную через `habits`).
 */
export async function insertEpisodes(pool: Pool, episodes: Episode[]): Promise<void> {
  if (episodes.length === 0) return;
  const values: unknown[] = [];
  const rowPlaceholders: string[] = [];
  for (const e of episodes) {
    const row = [
      e.id,
      e.creatureId,
      e.tick,
      e.type,
      e.participants,
      e.significance,
      e.consumedByReflection,
      e.learnedFrom ?? null,
      e.transmissionDepth,
      e.coreMemory,
    ];
    const base = values.length;
    rowPlaceholders.push(`(${row.map((_, j) => `$${base + j + 1}`).join(", ")})`);
    values.push(...row);
  }
  await pool.query(
    `INSERT INTO episodes (id, creature_id, tick, type, participants, significance, consumed_by_reflection, learned_from, transmission_depth, core_memory)
     VALUES ${rowPlaceholders.join(", ")} ON CONFLICT (id) DO NOTHING`,
    values,
  );
}

export async function insertWorldEvents(pool: Pool, events: WorldEvent[]): Promise<void> {
  if (events.length === 0) return;
  const values: unknown[] = [];
  const rowPlaceholders: string[] = [];
  for (const e of events) {
    const row = [e.id, e.tick, e.type, e.actorId ?? null, e.targetId ?? null, e.zone ?? null, JSON.stringify(e.payload)];
    const base = values.length;
    rowPlaceholders.push(`(${row.map((_, j) => `$${base + j + 1}`).join(", ")})`);
    values.push(...row);
  }
  await pool.query(
    `INSERT INTO world_events (id, tick, type, actor_id, target_id, zone, payload) VALUES ${rowPlaceholders.join(", ")} ON CONFLICT (id) DO NOTHING`,
    values,
  );
}

/** INSERT новых сигналов (А.2 `signals`) — outcome может быть pending или уже финальным. */
export async function insertSignals(pool: Pool, signals: SignalRecord[]): Promise<void> {
  if (signals.length === 0) return;
  const values: unknown[] = [];
  const rowPlaceholders: string[] = [];
  for (const s of signals) {
    const row = [s.id, s.senderId, s.tick, s.type, s.zone, s.trueState, s.claimedState, s.outcome, s.receivers];
    const base = values.length;
    rowPlaceholders.push(`(${row.map((_, j) => `$${base + j + 1}`).join(", ")})`);
    values.push(...row);
  }
  await pool.query(
    `INSERT INTO signals (id, sender_id, tick, type, zone, true_state, claimed_state, outcome, receivers)
     VALUES ${rowPlaceholders.join(", ")} ON CONFLICT (id) DO NOTHING`,
    values,
  );
}

/** UPDATE outcome после подтверждения/опровержения (7.8). */
export async function updateSignalOutcomes(pool: Pool, signals: SignalRecord[]): Promise<void> {
  if (signals.length === 0) return;
  // По одному UPDATE — объём мал (единицы сигналов на тик), а batch UNNEST
  // по UUID+enum усложняет типы без выигрыша на этом масштабе.
  for (const s of signals) {
    if (s.outcome === "pending") continue;
    await pool.query(`UPDATE signals SET outcome = $2 WHERE id = $1 AND outcome = 'pending'`, [s.id, s.outcome]);
  }
}

/** INSERT сэмплированных utility-решений (А.2 `decision_log`, семплинг А.9). */
export async function insertDecisionLogs(pool: Pool, entries: DecisionLogEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const values: unknown[] = [];
  const rowPlaceholders: string[] = [];
  for (const e of entries) {
    const row = [e.creatureId, e.tick, e.chosenAction, JSON.stringify(e.factors)];
    const base = values.length;
    rowPlaceholders.push(`(${row.map((_, j) => `$${base + j + 1}`).join(", ")})`);
    values.push(...row);
  }
  await pool.query(
    `INSERT INTO decision_log (creature_id, tick, chosen_action, factors) VALUES ${rowPlaceholders.join(", ")}`,
    values,
  );
}

/**
 * Полная синхронизация bonds с in-memory состоянием (раз в snapshot_interval_ticks,
 * вместе с "full" upsertCreatures). bonds не ведёт историю (А.2: только текущее
 * состояние) — DELETE+INSERT в транзакции проще и корректнее инкрементального
 * diff при населении в единицы сотен пар.
 */
export async function syncBonds(pool: Pool, bonds: BondRecord[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM bonds");
    if (bonds.length > 0) {
      const values: unknown[] = [];
      const rowPlaceholders: string[] = [];
      for (const b of bonds) {
        const row = [b.creatureA, b.creatureB, b.kind, b.strength];
        const base = values.length;
        rowPlaceholders.push(`(${row.map((_, j) => `$${base + j + 1}`).join(", ")})`);
        values.push(...row);
      }
      await client.query(`INSERT INTO bonds (creature_a, creature_b, kind, strength) VALUES ${rowPlaceholders.join(", ")}`, values);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Полная синхронизация aversions — тот же приём, что и syncBonds (DELETE+INSERT
 * в транзакции), добавлено в фазе 7: без этого личное избегание (7.2, А.10)
 * не переживало рестарт sim-engine, хотя влияет на решения (aversionStrengthLookup)
 * — раньше просто не было персистентности вовсе (см. ops/DEVIATIONS.md, фаза 7).
 */
export async function syncAversions(pool: Pool, aversions: AversionRecord[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM aversions");
    if (aversions.length > 0) {
      const values: unknown[] = [];
      const rowPlaceholders: string[] = [];
      for (const a of aversions) {
        const row = [a.subjectId, a.objectId, a.strength];
        const base = values.length;
        rowPlaceholders.push(`(${row.map((_, j) => `$${base + j + 1}`).join(", ")})`);
        values.push(...row);
      }
      await client.query(`INSERT INTO aversions (subject_id, object_id, strength) VALUES ${rowPlaceholders.join(", ")}`, values);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Полная синхронизация краткоживущих социально-сигнальных состояний (А.2).
 * Как и bonds/aversions, эти таблицы отражают только актуальный RAM-снимок,
 * поэтому на полном снапшоте заменяются целиком в транзакции.
 */
export async function syncPerceivedStates(pool: Pool, creatures: Creature[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM perceived_states");

    const values: unknown[] = [];
    const rowPlaceholders: string[] = [];
    for (const observer of creatures) {
      for (const [subjectId, state] of observer.perceivedStates) {
        const base = values.length;
        rowPlaceholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
        values.push(
          observer.id,
          subjectId,
          toPgReal(state.perceivedVigor),
          toPgReal(state.perceivedThreat),
          Number.isFinite(state.lastSignalTick) ? state.lastSignalTick : null,
        );
      }
    }
    if (values.length > 0) {
      await client.query(
        `INSERT INTO perceived_states (observer_id, subject_id, perceived_vigor, perceived_threat, last_signal_tick)
         VALUES ${rowPlaceholders.join(", ")}`,
        values,
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function syncPerceivedZoneThreat(pool: Pool, creatures: Creature[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM perceived_zone_threat");

    const values: unknown[] = [];
    const rowPlaceholders: string[] = [];
    for (const observer of creatures) {
      for (const [zone, threat] of observer.perceivedZoneThreat) {
        const base = values.length;
        rowPlaceholders.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
        values.push(observer.id, zone, toPgReal(threat));
      }
    }
    if (values.length > 0) {
      await client.query(`INSERT INTO perceived_zone_threat (observer_id, zone, threat) VALUES ${rowPlaceholders.join(", ")}`, values);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function syncSignalTrust(pool: Pool, creatures: Creature[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM signal_trust");

    const values: unknown[] = [];
    const rowPlaceholders: string[] = [];
    for (const observer of creatures) {
      for (const [signalerId, entry] of observer.trust) {
        const base = values.length;
        rowPlaceholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
        values.push(observer.id, signalerId, entry.trust, entry.confirmations, entry.disconfirmations);
      }
    }
    if (values.length > 0) {
      await client.query(
        `INSERT INTO signal_trust (observer_id, signaler_id, trust, confirmations, disconfirmations)
         VALUES ${rowPlaceholders.join(", ")}`,
        values,
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Атомарная персистентность самого первого состояния мира (genesis, 6.1):
 * INSERT genesis-популяции и world_clock в ОДНОЙ транзакции.
 *
 * До этой правки creatures и world_clock писались раздельно двумя отдельными
 * await (upsertCreatures в первом persistTick(), потом updateWorldClock чуть
 * позже в той же функции) — крах процесса МЕЖДУ этими двумя запросами (после
 * того, как genesis-особи уже вставлены, но до записи world_clock) оставлял
 * БД в состоянии "особи есть, world_clock пуст". Следующий запуск
 * loadWorldState видел пустой world_clock, считал это холодным стартом и
 * запускал genesis ЕЩЁ РАЗ поверх уже существующих особей — ровно тот баг,
 * что обнаружился при приёмке (40->80 пингвинов, 4->8 касаток, все с
 * parent_a IS NULL, см. ops/DEVIATIONS.md, фаза 7). Транзакция делает два
 * INSERT неразрывными: Postgres либо закоммитит оба, либо откатит оба —
 * частичного состояния "особи без world_clock" при использовании этой
 * функции возникнуть не может.
 */
export async function persistGenesis(
  pool: Pool,
  creatures: Creature[],
  tick: number,
  phase: "day" | "night",
  fishDensity?: Record<string, number>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (creatures.length > 0) {
      const values: unknown[] = [];
      const rowPlaceholders: string[] = [];
      for (const creature of creatures) {
        const row = creatureRowValues(creature);
        const base = values.length;
        rowPlaceholders.push(`(${row.map((_, j) => `$${base + j + 1}`).join(", ")})`);
        values.push(...row);
      }
      await client.query(
        `INSERT INTO creatures (${FULL_COLUMNS.join(", ")}) VALUES ${rowPlaceholders.join(", ")} ON CONFLICT (id) DO NOTHING`,
        values,
      );
      // Birth trait_history в той же транзакции, что и genesis-популяция.
      const thValues: unknown[] = [];
      const thPlaceholders: string[] = [];
      for (const creature of creatures) {
        const base = thValues.length;
        thPlaceholders.push(`($${base + 1}::uuid, $${base + 2}::bigint, $${base + 3}::jsonb)`);
        thValues.push(creature.id, creature.bornAtTick, JSON.stringify(creature.traitsBirth));
      }
      await client.query(
        `INSERT INTO trait_history (creature_id, tick, traits, source)
         SELECT v.creature_id, v.tick, v.traits, 'birth'
         FROM (VALUES ${thPlaceholders.join(", ")}) AS v(creature_id, tick, traits)
         WHERE NOT EXISTS (
           SELECT 1 FROM trait_history th
           WHERE th.creature_id = v.creature_id AND th.source = 'birth'
         )`,
        thValues,
      );
    }
    await client.query(
      `INSERT INTO world_clock (id, tick, phase, fish_density, updated_at) VALUES (1, $1, $2, $3, now())
       ON CONFLICT (id) DO UPDATE SET tick = EXCLUDED.tick, phase = EXCLUDED.phase, fish_density = EXCLUDED.fish_density, updated_at = now()`,
      [tick, phase, fishDensity ? JSON.stringify(fishDensity) : null],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function updateWorldClock(
  pool: Pool,
  tick: number,
  phase: "day" | "night",
  fishDensity?: Record<string, number>,
): Promise<void> {
  await pool.query(
    `INSERT INTO world_clock (id, tick, phase, fish_density, updated_at) VALUES (1, $1, $2, $3, now())
     ON CONFLICT (id) DO UPDATE SET tick = EXCLUDED.tick, phase = EXCLUDED.phase, fish_density = EXCLUDED.fish_density, updated_at = now()`,
    [tick, phase, fishDensity ? JSON.stringify(fishDensity) : null],
  );
}

/** Лёгкий сигнал "тик N готов" для api-gateway (LISTEN world_tick) — не несёт данных существ (лимит NOTIFY 8000 байт), см. ops/DEVIATIONS.md. */
export async function notifyTick(pool: Pool, tick: number, phase: "day" | "night"): Promise<void> {
  await pool.query(`SELECT pg_notify('world_tick', $1)`, [JSON.stringify({ tick, phase })]);
}
