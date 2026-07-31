import type { ServerResponse } from "node:http";
import type { Pool } from "pg";
import { getConstants } from "./config.js";
import { ageStageFor, ageWeeksAt } from "./age.js";
import { sendJson } from "./http.js";
import { getCreatureCard, getCreatureTimeline, getSocialGraph, getWorldClock, getWorldStats, type WorldEventRow } from "./queries.js";

/**
 * REST (read-only, публичный, А.6). Как и queries.ts — ни один обработчик
 * не читает и не отдаёт `creatures.narrative` (только `narrative_facts`).
 */

function timelineDto(events: WorldEventRow[]) {
  return events.map((e) => ({
    id: e.id,
    tick: Number(e.tick),
    type: e.type,
    actor_id: e.actor_id,
    target_id: e.target_id,
    zone: e.zone,
    payload: e.payload,
  }));
}

const CREATURE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleCreatureCard(res: ServerResponse, pool: Pool, id: string): Promise<void> {
  if (!CREATURE_ID_RE.test(id)) {
    sendJson(res, 400, { error: "некорректный id" });
    return;
  }
  const [card, clock] = await Promise.all([getCreatureCard(pool, id), getWorldClock(pool)]);
  if (!card) {
    sendJson(res, 404, { error: "существо не найдено" });
    return;
  }
  const timeline = await getCreatureTimeline(pool, id);
  const ageWeeks = ageWeeksAt(Number(card.born_at_tick), clock.tick, getConstants().time.visual_tick_seconds);

  const leadingSkills = Object.entries(card.skills)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([skill, value]) => ({ skill, value }));

  sendJson(res, 200, {
    id: card.id,
    species: card.species,
    name: card.name,
    sex: card.sex,
    age_weeks: Number(ageWeeks.toFixed(2)),
    alive: card.died_at_tick === null,
    death_cause: card.death_cause,
    traits: card.traits,
    needs: card.needs,
    emotion: card.emotion,
    is_asleep: card.is_asleep,
    leading_skills: leadingSkills,
    narrative_facts: card.narrative_facts,
    timeline: timelineDto(timeline),
  });
}

interface SocialGraphCacheEntry {
  body: unknown;
  expiresAt: number;
}

let socialGraphCache: SocialGraphCacheEntry | undefined;

export async function handleSocialGraph(res: ServerResponse, pool: Pool): Promise<void> {
  const now = Date.now();
  if (socialGraphCache && socialGraphCache.expiresAt > now) {
    sendJson(res, 200, socialGraphCache.body);
    return;
  }
  const graph = await getSocialGraph(pool);
  const body = { nodes: graph.nodes, edges: graph.edges };
  socialGraphCache = { body, expiresAt: now + getConstants().api.social_graph_cache_seconds * 1000 };
  sendJson(res, 200, body);
}

/** Только для тестов. */
export function resetSocialGraphCache(): void {
  socialGraphCache = undefined;
}

export async function handleWorldStats(res: ServerResponse, pool: Pool): Promise<void> {
  const stats = await getWorldStats(pool);
  sendJson(res, 200, {
    tick: stats.tick,
    phase: stats.phase,
    population: stats.population,
    generation: stats.generation,
  });
}
