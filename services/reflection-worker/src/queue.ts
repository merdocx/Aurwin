import type { Pool } from "pg";
import { isLlmDailyBudgetExceeded, llmSpendLast24hUsd } from "./budgetGate.js";
import { getConstants } from "./constants.js";
import {
  countRecentEventReflections,
  fetchUnconsumedEpisodes,
  findDueBackgroundCandidates,
  findDueEventCandidates,
  insertQueuedReflection,
  insertSkippedEmptyBackground,
} from "./db.js";
import { buildReflectionRequest } from "./request.js";
import type { ReflectionCandidate } from "./types.js";

export interface QueuedCandidate {
  candidate: ReflectionCandidate;
  reflectionId: string;
}

/**
 * Отбор кандидатов на рефлексию (7.3): дебаунс и восстановление после рестарта
 * в SQL db.ts. Здесь — глобальные лимиты и жёсткий стоп по llm_daily_budget_usd.
 */
export async function selectCandidates(pool: Pool): Promise<QueuedCandidate[]> {
  const constants = getConstants().reflection;
  const selected: QueuedCandidate[] = [];

  if (isLlmDailyBudgetExceeded()) {
    console.warn(
      `[reflection-worker] суточный бюджет LLM исчерпан (spent≈$${llmSpendLast24hUsd().toFixed(3)} ≥ $${constants.llm_daily_budget_usd}) — новые кандидаты не ставятся`,
    );
    return selected;
  }

  const eventIds = await findDueEventCandidates(pool);
  if (eventIds.length > 0) {
    const [hourly, daily] = await Promise.all([
      countRecentEventReflections(pool, 1),
      countRecentEventReflections(pool, 24),
    ]);
    const remainingHourly = Math.max(0, constants.event_global_limit_per_hour - hourly);
    const remainingDaily = Math.max(0, constants.event_global_limit_per_day - daily);
    const allowed = Math.min(remainingHourly, remainingDaily, eventIds.length);

    for (let i = 0; i < allowed; i++) {
      if (isLlmDailyBudgetExceeded()) break;
      const creatureId = eventIds[i];
      const candidate: ReflectionCandidate = { creatureId, kind: "event", mergedEpisodeIds: [] };
      const built = await buildReflectionRequest(pool, candidate);
      if (!built) continue;
      candidate.mergedEpisodeIds = built.unconsumedEpisodeIds;
      const reflectionId = await insertQueuedReflection(pool, {
        creatureId,
        kind: "event",
        mergedEpisodeIds: built.unconsumedEpisodeIds,
        request: built.payload,
      });
      selected.push({ candidate, reflectionId });
    }
  }

  if (isLlmDailyBudgetExceeded()) return selected;

  const backgroundIds = await findDueBackgroundCandidates(pool);
  for (const creatureId of backgroundIds) {
    if (isLlmDailyBudgetExceeded()) break;
    const unconsumed = await fetchUnconsumedEpisodes(pool, creatureId);
    if (unconsumed.length === 0) {
      await insertSkippedEmptyBackground(pool, creatureId);
      continue;
    }
    const candidate: ReflectionCandidate = { creatureId, kind: "background", mergedEpisodeIds: [] };
    const built = await buildReflectionRequest(pool, candidate);
    if (!built) continue;
    candidate.mergedEpisodeIds = built.unconsumedEpisodeIds;
    const reflectionId = await insertQueuedReflection(pool, {
      creatureId,
      kind: "background",
      mergedEpisodeIds: built.unconsumedEpisodeIds,
      request: built.payload,
    });
    selected.push({ candidate, reflectionId });
  }

  return selected;
}
