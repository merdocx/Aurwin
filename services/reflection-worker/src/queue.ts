import type { Pool } from "pg";
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
 * Отбор кандидатов на рефлексию (7.3): дебаунс (4ч событийная / 24ч фоновая)
 * и восстановление после рестарта воркера уже реализованы в SQL db.ts
 * (NOT EXISTS по истории `reflections` — переживает рестарт процесса, в
 * отличие от in-memory состояния). Здесь — то, что требует СОВМЕСТНОГО
 * решения по всей популяции разом:
 *   - глобальный лимит событийных вызовов (30/час И 120/сутки, 7.3) —
 *     двухуровневый, лимитирующим является более строгий из двух;
 *   - "слияние событий окна" — гарантируется тем, что buildReflectionRequest
 *     (request.ts) забирает ВСЕ непоглощённые эпизоды существа одним
 *     запросом, а не только тот, что удовлетворил триггер;
 *   - фоновая рефлексия глобального лимита не имеет (7.3/7.6 ограничивают
 *     только "событийные вызовы"; фоновая и так ограничена 24ч/существо +
 *     идёт через дешёвый Batch API).
 *
 * Каждый отобранный кандидат СРАЗУ получает строку `reflections` со
 * статусом 'queued' — это (а) резервирует его немедленно, чтобы повторный
 * проход selectCandidates (в т.ч. после падения процесса) не выбрал его
 * снова, пока вызов LLM не завершится или не провалится, и (б) сам факт
 * наличия этой строки — то самое "очередь копится" при недоступности API
 * (7.3, деградация): застрявшие 'queued'/'failed' строки видны в БД, а не
 * теряются вместе с процессом.
 */
export async function selectCandidates(pool: Pool): Promise<QueuedCandidate[]> {
  const constants = getConstants().reflection;
  const selected: QueuedCandidate[] = [];

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
      const creatureId = eventIds[i];
      const candidate: ReflectionCandidate = { creatureId, kind: "event", mergedEpisodeIds: [] };
      const built = await buildReflectionRequest(pool, candidate);
      if (!built) continue; // существо умерло между отбором и сборкой запроса
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

  const backgroundIds = await findDueBackgroundCandidates(pool);
  for (const creatureId of backgroundIds) {
    // Skip empty background: нет непоглощённых эпизодов — не тратим LLM,
    // но фиксируем interval bookkeeping (discarded-строка), иначе due каждые N мин.
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
