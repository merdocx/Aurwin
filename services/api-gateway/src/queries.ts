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
}

export async function getWorldClock(pool: Pool): Promise<WorldClock> {
  const result = await pool.query<{ tick: string; phase: string }>(`SELECT tick, phase FROM world_clock WHERE id = 1`);
  if (result.rows.length === 0) return { tick: 0, phase: "day" };
  return { tick: Number(result.rows[0].tick), phase: result.rows[0].phase as "day" | "night" };
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
  born_at_tick: string;
}

export async function getAliveCreaturesLight(pool: Pool): Promise<LiveCreatureRow[]> {
  const result = await pool.query<LiveCreatureRow>(
    `SELECT id, species, name, pos_x, pos_y, zone, emotion, is_asleep, born_at_tick
     FROM creatures WHERE died_at_tick IS NULL`,
  );
  return result.rows;
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

export async function getWorldEventsSinceTick(pool: Pool, sinceTick: number, limit = 500): Promise<WorldEventRow[]> {
  const result = await pool.query<WorldEventRow>(
    `SELECT id, tick, type, actor_id, target_id, zone, payload, created_at
     FROM world_events WHERE tick > $1 ORDER BY tick ASC LIMIT $2`,
    [sinceTick, limit],
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
}

export async function getCreatureCard(pool: Pool, id: string): Promise<CreatureCardRow | undefined> {
  const result = await pool.query<CreatureCardRow>(
    `SELECT id, species, name, sex, born_at_tick, died_at_tick, death_cause,
            traits, needs, emotion, skills, is_asleep, narrative_facts
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
}

export async function getSocialGraph(pool: Pool): Promise<{ nodes: SocialGraphNode[]; edges: SocialGraphEdge[] }> {
  const [nodesResult, edgesResult] = await Promise.all([
    pool.query<SocialGraphNode>(`SELECT id, species, name FROM creatures WHERE died_at_tick IS NULL`),
    // aversions наружу не отдаются (А.6): страхи существа — часть его
    // внутреннего мира, не публичная социальная структура.
    pool.query<{ creature_a: string; creature_b: string; strength: number }>(
      `SELECT creature_a, creature_b, strength FROM bonds WHERE kind = 'friend'`,
    ),
  ]);
  return {
    nodes: nodesResult.rows,
    edges: edgesResult.rows.map((r) => ({ a: r.creature_a, b: r.creature_b, strength: r.strength })),
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
