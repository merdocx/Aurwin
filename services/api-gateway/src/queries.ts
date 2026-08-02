import type { Pool } from "pg";

/**
 * Все запросы этого модуля намеренно НЕ выбирают колонку `creatures.narrative`
 * — полный self-narrative наблюдателю не отдаётся ни одним публичным
 * эндпоинтом (6.1, А.6). Это единственное место, откуда api-gateway читает
 * creatures/world_events/bonds, поэтому запрет проще всего гарантировать
 * здесь: ни один SELECT в файле не перечисляет "narrative" среди колонок.
 */

export interface WorldClock {
  tick: number;
  phase: "day" | "night";
  fishDensity: Record<string, number>;
}

export async function getWorldClock(pool: Pool): Promise<WorldClock> {
  const result = await pool.query<{ tick: string; phase: string; fish_density: Record<string, number> | null }>(
    `SELECT tick, phase, fish_density FROM world_clock WHERE id = 1`,
  );
  if (result.rows.length === 0) return { tick: 0, phase: "day", fishDensity: {} };
  return {
    tick: Number(result.rows[0].tick),
    phase: result.rows[0].phase as "day" | "night",
    fishDensity: result.rows[0].fish_density ?? {},
  };
}

export interface LiveCreatureRow {
  id: string;
  species: "penguin" | "orca";
  name: string;
  pos_x: number;
  pos_y: number;
  zone: string;
  emotion: { valence: number; arousal: number };
  is_asleep: boolean;
  activity: string | null;
  /** Первая intention (observer-safe); для облачка мысли на карте. */
  thought: string | null;
  born_at_tick: string;
}

export async function getAliveCreaturesLight(pool: Pool): Promise<LiveCreatureRow[]> {
  const result = await pool.query<LiveCreatureRow>(
    `SELECT id, species, name, pos_x, pos_y, zone, emotion, is_asleep, activity, born_at_tick,
            NULLIF(BTRIM(intentions->0->>'text'), '') AS thought
     FROM creatures WHERE died_at_tick IS NULL`,
  );
  return result.rows;
}

/** Курсор WS world_events: стартовать с хвоста, без реплея истории. */
export async function getMaxWorldEventTick(pool: Pool): Promise<number> {
  const result = await pool.query<{ max: string }>(`SELECT COALESCE(MAX(tick), 0)::text AS max FROM world_events`);
  return Number(result.rows[0]?.max ?? 0);
}

export interface WorldEventRow {
  id: string;
  tick: string;
  type: string;
  actor_id: string | null;
  target_id: string | null;
  zone: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export async function getWorldEventsSinceTick(
  pool: Pool,
  sinceTick: number,
  opts: { sinceId?: string; limit?: number } = {},
): Promise<WorldEventRow[]> {
  const limit = opts.limit ?? 500;
  const sinceId = opts.sinceId ?? "00000000-0000-0000-0000-000000000000";
  const result = await pool.query<WorldEventRow>(
    `SELECT id, tick, type, actor_id, target_id, zone, payload, created_at
     FROM world_events
     WHERE tick > $1 OR (tick = $1 AND id > $2::uuid)
     ORDER BY tick ASC, id ASC
     LIMIT $3`,
    [sinceTick, sinceId, limit],
  );
  return result.rows;
}

export interface CreatureCardRow {
  id: string;
  species: "penguin" | "orca";
  name: string;
  sex: "m" | "f";
  born_at_tick: string;
  died_at_tick: string | null;
  death_cause: string | null;
  traits: Record<string, number>;
  needs: Record<string, number>;
  emotion: { valence: number; arousal: number };
  skills: Record<string, number>;
  is_asleep: boolean;
  narrative_facts: string[];
  intentions: Array<{ text: string; effect?: Record<string, unknown> }>;
  habits: Record<string, number>;
}

export async function getCreatureCard(pool: Pool, id: string): Promise<CreatureCardRow | undefined> {
  const result = await pool.query<CreatureCardRow>(
    `SELECT id, species, name, sex, born_at_tick, died_at_tick, death_cause,
            traits, needs, emotion, skills, is_asleep, narrative_facts, intentions, habits
     FROM creatures WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

export async function getCreatureTimeline(pool: Pool, id: string, limit = 30): Promise<WorldEventRow[]> {
  const result = await pool.query<WorldEventRow>(
    `SELECT id, tick, type, actor_id, target_id, zone, payload, created_at
     FROM world_events WHERE actor_id = $1 OR target_id = $1
     ORDER BY tick DESC LIMIT $2`,
    [id, limit],
  );
  return result.rows;
}

export interface SocialGraphNode {
  id: string;
  species: "penguin" | "orca";
  name: string;
}

export interface SocialGraphEdge {
  a: string;
  b: string;
  strength: number;
  /** friend = дружба, mate = пара/любовь, kin = родство (родитель–потомок). */
  kind: "friend" | "mate" | "kin";
}

export async function getSocialGraph(pool: Pool): Promise<{ nodes: SocialGraphNode[]; edges: SocialGraphEdge[] }> {
  const [nodesResult, bondsResult, kinResult] = await Promise.all([
    pool.query<SocialGraphNode>(`SELECT id, species, name FROM creatures WHERE died_at_tick IS NULL`),
    // aversions наружу не отдаются (А.6).
    pool.query<{ creature_a: string; creature_b: string; strength: number; kind: "friend" | "mate" }>(
      `SELECT creature_a, creature_b, strength, kind FROM bonds WHERE kind IN ('friend', 'mate')`,
    ),
    pool.query<{ child_id: string; parent_id: string }>(`
      SELECT c.id AS child_id, p.id AS parent_id
      FROM creatures c
      JOIN creatures p ON p.id IN (c.parent_a, c.parent_b)
      WHERE c.died_at_tick IS NULL AND p.died_at_tick IS NULL
    `),
  ]);

  const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const edges = new Map<string, SocialGraphEdge>();

  for (const r of bondsResult.rows) {
    const key = edgeKey(r.creature_a, r.creature_b);
    const existing = edges.get(key);
    // mate важнее friend при дубликате.
    if (!existing || (existing.kind === "friend" && r.kind === "mate")) {
      edges.set(key, {
        a: r.creature_a,
        b: r.creature_b,
        strength: Number(r.strength),
        kind: r.kind,
      });
    }
  }

  for (const r of kinResult.rows) {
    const key = edgeKey(r.child_id, r.parent_id);
    if (edges.has(key)) continue; // уже friend/mate — не перекрываем
    edges.set(key, {
      a: r.parent_id,
      b: r.child_id,
      strength: 0.55,
      kind: "kin",
    });
  }

  return {
    nodes: nodesResult.rows,
    edges: [...edges.values()],
  };
}

export interface WorldStats {
  tick: number;
  phase: "day" | "night";
  population: Record<string, number>;
  generation: number;
}

export async function getWorldStats(pool: Pool): Promise<WorldStats> {
  const clock = await getWorldClock(pool);
  const [populationResult, generationResult] = await Promise.all([
    pool.query<{ species: string; count: string }>(
      `SELECT species, count(*) FROM creatures WHERE died_at_tick IS NULL GROUP BY species`,
    ),
    pool.query<{ max_generation: number }>(`
      WITH RECURSIVE gen(id, generation) AS (
        SELECT id, 0 FROM creatures WHERE parent_a IS NULL AND parent_b IS NULL
        UNION
        SELECT c.id, gen.generation + 1
        FROM creatures c
        JOIN gen ON c.parent_a = gen.id OR c.parent_b = gen.id
      )
      SELECT COALESCE(MAX(generation), 0) AS max_generation
      FROM gen JOIN creatures c ON c.id = gen.id
      WHERE c.died_at_tick IS NULL
    `),
  ]);

  const population: Record<string, number> = {};
  for (const row of populationResult.rows) population[row.species] = Number(row.count);

  return {
    tick: clock.tick,
    phase: clock.phase,
    population,
    generation: generationResult.rows[0]?.max_generation ?? 0,
  };
}
