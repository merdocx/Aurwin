import type { Pool } from "pg";
import type { AversionRecord, BondRecord, Creature, Episode, WorldEvent } from "../sim/types.js";

/**
 * Персистентность sim-engine (А.3, шаги 13-14; ops/DEVIATIONS.md, фаза 5).
 *
 * Две частоты записи creatures, обе используют ОДИН и тот же полный набор
 * колонок для VALUES (значения и так уже в памяти — дёшево сериализовать
 * JSONB целиком), но РАЗНЫЙ набор колонок в ON CONFLICT DO UPDATE:
 *   - "light" (каждый тик, ~2 сек): только позиция/зона/эмоция/сон — это
 *     единственные поля, нужные наблюдателю между полными снапшотами (А.6:
 *     "delta каждые 1-2 сек").
 *   - "full" (раз в time.snapshot_interval_ticks, ~30 тиков/1 мин, А.9
 *     "Снапшот в БД"): все столбцы, включая тяжёлые JSONB (narrative,
 *     weights, habits, intentions) — устойчивость к рестарту (6.1).
 * Так INSERT новой строки (genesis/новорождённый) всегда полноценен вне
 * зависимости от режима, а частая запись остаётся дешёвой.
 */

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
  "authority",
  "habits",
  "weights",
  "weights_birth",
  "last_reflection_at",
] as const;

const LIGHT_UPDATE_COLUMNS = ["pos_x", "pos_y", "zone", "emotion", "is_asleep"] as const;

/**
 * Колонки, которые reflection-worker (фаза 6) применяет НАПРЯМУЮ в Postgres
 * (services/reflection-worker/src/apply.ts) — traits/weights/narrative/
 * narrative_facts/intentions/last_reflection_at. sim-engine держит СВОЮ
 * in-memory копию этих полей (Creature.traits и т.д.), которая обновляется
 * реальными значениями только при restore (persistence/restore.ts) — то
 * есть при рестарте процесса, не "вживую" в том же запуске (см.
 * ops/DEVIATIONS.md, фаза 6: доработка живой синхронизации без рестарта —
 * рекомендованный follow-up, не входит в эту фазу).
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
    c.pos.x,
    c.pos.y,
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
    c.authority,
    JSON.stringify(c.habits),
    JSON.stringify(c.weights),
    JSON.stringify(c.weightsBirth),
    c.lastReflectionAt,
  ];
}

/** Только для ЖИВЫХ существ (сравни с applyDeaths ниже) — вызывающая сторона гарантирует это (index.ts). */
export async function upsertCreatures(pool: Pool, creatures: Creature[], mode: "light" | "full"): Promise<void> {
  if (creatures.length === 0) return;
  const updateCols = mode === "full" ? FULL_COLUMNS.filter((c) => c !== "id" && !REFLECTION_OWNED_COLUMNS.has(c)) : LIGHT_UPDATE_COLUMNS;
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

export async function updateWorldClock(pool: Pool, tick: number, phase: "day" | "night"): Promise<void> {
  await pool.query(
    `INSERT INTO world_clock (id, tick, phase, updated_at) VALUES (1, $1, $2, now())
     ON CONFLICT (id) DO UPDATE SET tick = EXCLUDED.tick, phase = EXCLUDED.phase, updated_at = now()`,
    [tick, phase],
  );
}

/** Лёгкий сигнал "тик N готов" для api-gateway (LISTEN world_tick) — не несёт данных существ (лимит NOTIFY 8000 байт), см. ops/DEVIATIONS.md. */
export async function notifyTick(pool: Pool, tick: number, phase: "day" | "night"): Promise<void> {
  await pool.query(`SELECT pg_notify('world_tick', $1)`, [JSON.stringify({ tick, phase })]);
}
