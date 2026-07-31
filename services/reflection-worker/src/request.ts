import type { Pool } from "pg";
import { ageStageFor, ageWeeksAt } from "./age.js";
import { getConstants } from "./constants.js";
import {
  buildNewEpisodesForPrompt,
  fetchAllEpisodeParticipantNames,
  fetchAversionsSummary,
  fetchBondsSummary,
  fetchCreatureRow,
  fetchDeceivedBy,
  fetchNamesMentionedInNarrative,
  fetchSignalHistory,
  fetchUnconsumedEpisodes,
  fetchWorldTick,
} from "./db.js";
import type { ReflectionCandidate, ReflectionRequestPayload } from "./types.js";

export interface BuiltRequest {
  payload: ReflectionRequestPayload;
  unconsumedEpisodeIds: string[];
  /** Все имена, реально присутствующие во входных данных этого запроса -> id (для validate.ts, 7.8.6/А.5). */
  nameToId: Map<string, string>;
}

function mergeNameMaps(...maps: Array<Map<string, string>>): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of maps) for (const [name, id] of m) out.set(name, id);
  return out;
}

/**
 * Собирает вход А.5 для одного кандидата. Возвращает undefined, если
 * существо за это время умерло/исчезло (гонка между отбором кандидата в
 * queue.ts и фактической сборкой запроса) — вызывающая сторона просто
 * пропускает такого кандидата, не тратя вызов LLM впустую.
 */
export async function buildReflectionRequest(pool: Pool, candidate: ReflectionCandidate): Promise<BuiltRequest | undefined> {
  const creature = await fetchCreatureRow(pool, candidate.creatureId);
  if (!creature || creature.died_at_tick !== null) return undefined;

  const constants = getConstants();
  const tick = await fetchWorldTick(pool);
  const ageWeeks = ageWeeksAt(Number(creature.born_at_tick), tick, constants.time.visual_tick_seconds);
  const stage = ageStageFor(creature.species, ageWeeks);

  const unconsumedEpisodes = await fetchUnconsumedEpisodes(pool, candidate.creatureId);
  const [episodesResult, bondsSummary, aversionsSummary, signalHistory, wasDeceivedBy, allEpisodeNames, narrativeNames] =
    await Promise.all([
      buildNewEpisodesForPrompt(pool, unconsumedEpisodes),
      fetchBondsSummary(pool, candidate.creatureId),
      fetchAversionsSummary(pool, candidate.creatureId),
      fetchSignalHistory(pool, candidate.creatureId),
      fetchDeceivedBy(pool, candidate.creatureId),
      fetchAllEpisodeParticipantNames(pool, candidate.creatureId),
      fetchNamesMentionedInNarrative(pool, creature.narrative ?? ""),
    ]);

  // Карта имя -> id: текущий вход + история эпизодов/narrative этого существа.
  // НЕ вся популяция — иначе валидация пропустила бы ссылку на реального,
  // но никак не связанного с этим существом персонажа (7.8.6/А.5).
  const nameToId = mergeNameMaps(episodesResult.nameToId, allEpisodeNames, narrativeNames);
  nameToId.set(creature.name, candidate.creatureId);
  for (const b of bondsSummary) nameToId.set(b.name, b.id);
  for (const a of aversionsSummary) nameToId.set(a.name, a.id);
  for (const d of wasDeceivedBy) nameToId.set(d.name, d.id);

  const payload: ReflectionRequestPayload = {
    creature: {
      species: creature.species,
      name: creature.name,
      age_weeks: Math.round(ageWeeks * 10) / 10,
      stage,
      traits: creature.traits,
      skills: creature.skills,
    },
    previous_narrative: creature.narrative ?? "",
    new_episodes: episodesResult.episodes,
    bonds_summary: bondsSummary.map(({ id: _id, ...rest }) => rest),
    aversions_summary: aversionsSummary.map(({ id: _id, ...rest }) => rest),
    habits_summary: creature.habits ?? {},
    signal_history: signalHistory,
    was_deceived_by: wasDeceivedBy.map(({ id: _id, ...rest }) => rest),
    reflection_kind: candidate.kind,
  };

  return { payload, unconsumedEpisodeIds: unconsumedEpisodes.map((e) => e.id), nameToId };
}

/**
 * Свежая карта имя->id для валидации ОТВЕТА, соответствующего уже
 * сохранённому в `reflections.request` (используется при повторе
 * "застрявшего" запроса после деградации API, фаза 6): сама заявка на
 * LLM переиспользуется как есть (это уже отправленный/сохранённый payload),
 * а nameToId для validate.ts пересобирается заново, так как отдельно он не
 * персистится (см. ops/DEVIATIONS.md, фаза 6) — расхождение с моментом
 * исходной сборки запроса не страшно: свежий контекст лишь точнее.
 */
export async function rebuildNameToId(pool: Pool, creatureId: string): Promise<Map<string, string>> {
  const creature = await fetchCreatureRow(pool, creatureId);
  if (!creature) return new Map();
  const unconsumedEpisodes = await fetchUnconsumedEpisodes(pool, creatureId);
  const [episodesResult, bondsSummary, aversionsSummary, wasDeceivedBy, allEpisodeNames, narrativeNames] = await Promise.all([
    buildNewEpisodesForPrompt(pool, unconsumedEpisodes),
    fetchBondsSummary(pool, creatureId),
    fetchAversionsSummary(pool, creatureId),
    fetchDeceivedBy(pool, creatureId),
    fetchAllEpisodeParticipantNames(pool, creatureId),
    fetchNamesMentionedInNarrative(pool, creature.narrative ?? ""),
  ]);
  const nameToId = mergeNameMaps(episodesResult.nameToId, allEpisodeNames, narrativeNames);
  nameToId.set(creature.name, creatureId);
  for (const b of bondsSummary) nameToId.set(b.name, b.id);
  for (const a of aversionsSummary) nameToId.set(a.name, a.id);
  for (const d of wasDeceivedBy) nameToId.set(d.name, d.id);
  return nameToId;
}
