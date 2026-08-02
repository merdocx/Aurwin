import type { Pool } from "pg";
import { ageStageFor, ageWeeksAt } from "./age.js";
import { getConstants } from "./constants.js";
import type {
  AversionSummary,
  BondSummary,
  CreatureRow,
  DeceivedByEntry,
  EpisodeRow,
  NewEpisodeForPrompt,
  ReflectionKind,
  SignalHistoryEntry,
} from "./types.js";

/**
 * Типы эпизодов, явно названные в 7.3 как триггеры СОБЫТИЙНОЙ рефлексии
 * ("смерть близкого, первая успешная охота, рождение потомства, разрыв/
 * начало «дружбы», взросление"). Это категориальный список (какие ТИПЫ
 * событий существуют), а не числовой параметр баланса, поэтому он в коде,
 * а не в constants.yaml — тот же принцип, что и TRAIT_KEYS/whitelist
 * эффектов намерений (см. ops/DEVIATIONS.md, фаза 6).
 *
 * Упрощение: "первая успешная охота" реализована как триггер на КАЖДЫЙ
 * hunt_success, а не только первый — отслеживание "первого раза" потребовало
 * бы отдельного счётчика, которого нет в схеме episodes; дебаунс и
 * глобальные лимиты (event_global_limit_per_*) не дают этому упрощению разогнать
 * бюджет (см. ops/DEVIATIONS.md, фаза 6 / 2026-08-02).
 *
 * Маршрутизация модели: EVENT_SONNET_TRIGGER_TYPES → Sonnet;
 * EVENT_HAIKU_TRIGGER_TYPES → Haiku (ops/DEVIATIONS.md, LLM cost opt).
 */
/**
 * Событийные триггеры на Sonnet (глубокая рефлексия, 7.3): смерть близкого,
 * начало дружбы, возрастные вехи. Частые/шумные типы — на Haiku
 * (ops/DEVIATIONS.md, LLM cost opt / 2026-08-02 budget).
 */
export const EVENT_SONNET_TRIGGER_TYPES = [
  "friend_died",
  "bond_formed",
  "matured",
  "grew_old",
] as const;

/**
 * Частые/шумные событийные триггеры — Haiku, не Sonnet.
 * `bond_broken` раньше был на Sonnet и раздувал бюджет (тысячи эпизодов/сутки).
 */
export const EVENT_HAIKU_TRIGGER_TYPES = ["birth", "hunt_success", "bond_broken"] as const;

export const EVENT_TRIGGER_TYPES = [...EVENT_SONNET_TRIGGER_TYPES, ...EVENT_HAIKU_TRIGGER_TYPES] as const;

/** Короткие описания типов эпизодов для читаемого `context` в new_episodes (А.5). Тон — сдержанный (7.3). */
const EPISODE_TYPE_LABELS: Record<string, string> = {
  friend_died: "гибель близкого",
  hunt_success: "удачная охота",
  hunt_attempt_survived_by_prey: "неудачная охота хищника на меня — я уцелел(а)",
  hunt_attempt_failed_by_hunter: "неудачная попытка охоты",
  birth: "рождение потомства",
  bond_formed: "начало дружбы",
  bond_broken: "разрыв дружбы",
  matured: "переход во взрослую жизнь",
  grew_old: "наступление старости",
  signal_disconfirmed_against_me: "меня обманул сигнал сородича",
  woken_by_alarm: "пробуждение по тревоге",
};

export async function findDueBackgroundCandidates(pool: Pool): Promise<string[]> {
  const hours = getConstants().reflection.background_interval_hours;
  const result = await pool.query<{ id: string }>(
    `
    SELECT c.id FROM creatures c
    WHERE c.died_at_tick IS NULL AND c.is_asleep = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM reflections r
        WHERE r.creature_id = c.id AND r.kind = 'background'
          AND r.created_at > now() - ($1::text || ' hours')::interval
      )
    `,
    [hours],
  );
  return result.rows.map((r) => r.id);
}

/**
 * Кандидаты на событийную рефлексию — упорядочены по возрасту САМОГО
 * СТАРОГО непоглощённого триггерного эпизода (FIFO): при упоре в глобальный
 * лимит (event_global_limit_per_*) первыми обслуживаются те, кто ждёт дольше всех,
 * а не случайный порядок.
 */
export async function findDueEventCandidates(pool: Pool): Promise<string[]> {
  const hours = getConstants().reflection.event_debounce_hours;
  const result = await pool.query<{ creature_id: string; species: "penguin" | "orca"; born_at_tick: string | number }>(
    `
    SELECT e.creature_id, c.species, c.born_at_tick, min(e.created_at) AS oldest
    FROM episodes e
    JOIN creatures c ON c.id = e.creature_id
    WHERE c.died_at_tick IS NULL
      AND e.consumed_by_reflection = FALSE
      AND e.type = ANY($1::text[])
      AND NOT EXISTS (
        SELECT 1 FROM reflections r
        WHERE r.creature_id = e.creature_id AND r.kind = 'event'
          AND r.created_at > now() - ($2::text || ' hours')::interval
      )
    GROUP BY e.creature_id, c.species, c.born_at_tick
    ORDER BY oldest ASC
    `,
    [EVENT_TRIGGER_TYPES as unknown as string[], hours],
  );
  // 7.4: детёныш — «рефлексия только фоновая»; событийную не ставим в очередь.
  const tick = await fetchWorldTick(pool);
  const visualTickSeconds = getConstants().time.visual_tick_seconds;
  return result.rows
    .filter((r) => {
      const weeks = ageWeeksAt(Number(r.born_at_tick), tick, visualTickSeconds);
      return ageStageFor(r.species, weeks) !== "juvenile";
    })
    .map((r) => r.creature_id);
}

/** Считает событийные рефлексии за скользящее окно — для глобальных лимитов (7.3). */
export async function countRecentEventReflections(pool: Pool, hours: number): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*)::int AS count FROM reflections WHERE kind = 'event' AND created_at > now() - ($1::text || ' hours')::interval`,
    [hours],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function fetchCreatureRow(pool: Pool, creatureId: string): Promise<CreatureRow | undefined> {
  const result = await pool.query<CreatureRow>(
    `SELECT id, species, name, born_at_tick, died_at_tick, traits, traits_birth, skills, habits,
            weights, weights_birth, narrative, narrative_facts, is_asleep, last_reflection_at
     FROM creatures WHERE id = $1`,
    [creatureId],
  );
  return result.rows[0];
}

/** Все ещё не поглощённые рефлексией эпизоды существа — "слияние событий окна" (7.3): все идут в ОДИН вызов. */
export async function fetchUnconsumedEpisodes(pool: Pool, creatureId: string): Promise<EpisodeRow[]> {
  const result = await pool.query<EpisodeRow>(
    `SELECT id, creature_id, tick, type, participants, significance, created_at, learned_from, transmission_depth
     FROM episodes WHERE creature_id = $1 AND consumed_by_reflection = FALSE ORDER BY created_at ASC`,
    [creatureId],
  );
  return result.rows;
}

/**
 * Участники ВСЕХ эпизодов существа (включая уже поглощённые рефлексией) —
 * нужны для nameToId при валидации ответа: previous_narrative и старые факты
 * карточки часто содержат имена из прошлых эпизодов, которых нет в текущем
 * new_episodes; без них валидатор ложно браковал честные пересказы
 * (см. ops/DEVIATIONS.md, 2026-07-31).
 */
export async function fetchAllEpisodeParticipantNames(pool: Pool, creatureId: string): Promise<Map<string, string>> {
  const result = await pool.query<{ id: string; name: string }>(
    `
    SELECT DISTINCT c.id, c.name
    FROM episodes e
    CROSS JOIN LATERAL unnest(e.participants) AS pid(id)
    JOIN creatures c ON c.id = pid.id
    WHERE e.creature_id = $1
    `,
    [creatureId],
  );
  return new Map(result.rows.map((r) => [r.name, r.id]));
}

/**
 * Имена из previous_narrative, которые реально существуют в creatures —
 * разрешает повторное упоминание уже известных существу существ без
 * расширения whitelist на всю популяцию (7.8.6: выдумка вроде «Никита»
 * по-прежнему отбраковывается).
 */
export async function fetchNamesMentionedInNarrative(pool: Pool, narrative: string): Promise<Map<string, string>> {
  if (!narrative.trim()) return new Map();
  const result = await pool.query<{ id: string; name: string }>(`SELECT id, name FROM creatures`);
  const out = new Map<string, string>();
  const lowerNarrative = narrative.toLowerCase();
  for (const row of result.rows) {
    if (row.name.length < 2) continue;
    // Префикс имени (без падежного хвоста) должен встречаться в тексте.
    const stem = row.name.slice(0, Math.max(2, row.name.length - 1)).toLowerCase();
    if (lowerNarrative.includes(stem)) out.set(row.name, row.id);
  }
  return out;
}

async function resolveNames(pool: Pool, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const result = await pool.query<{ id: string; name: string }>(`SELECT id, name FROM creatures WHERE id = ANY($1::uuid[])`, [ids]);
  return new Map(result.rows.map((r) => [r.id, r.name]));
}

export interface EpisodesForPromptResult {
  episodes: NewEpisodeForPrompt[];
  /** participant id -> name, для сборки nameToId в validate.ts (существующие ссылки, 7.8.6/А.5). */
  nameToId: Map<string, string>;
}

export async function buildNewEpisodesForPrompt(pool: Pool, episodes: EpisodeRow[]): Promise<EpisodesForPromptResult> {
  const participantIds = [...new Set(episodes.flatMap((e) => e.participants))];
  const names = await resolveNames(pool, participantIds);
  const nameToId = new Map<string, string>();
  for (const [id, name] of names) nameToId.set(name, id);

  const forPrompt = episodes.map((e) => {
    const who = e.participants.map((id) => names.get(id) ?? "неизвестный").join(", ") || "—";
    return {
      type: e.type,
      who,
      context: EPISODE_TYPE_LABELS[e.type] ?? e.type,
      witnessed: e.learned_from ? ("от сородичей" as const) : ("лично" as const),
    };
  });
  return { episodes: forPrompt, nameToId };
}

export interface BondSummaryWithId extends BondSummary {
  id: string;
}

export async function fetchBondsSummary(pool: Pool, creatureId: string): Promise<BondSummaryWithId[]> {
  const result = await pool.query<{ id: string; name: string; kind: "friend" | "mate"; strength: number }>(
    `
    SELECT CASE WHEN b.creature_a = $1 THEN b.creature_b ELSE b.creature_a END AS id,
           CASE WHEN b.creature_a = $1 THEN cb.name ELSE ca.name END AS name, b.kind, b.strength
    FROM bonds b
    JOIN creatures ca ON ca.id = b.creature_a
    JOIN creatures cb ON cb.id = b.creature_b
    WHERE b.creature_a = $1 OR b.creature_b = $1
    `,
    [creatureId],
  );
  return result.rows;
}

/**
 * aversions (А.2) не хранит момент возникновения — только strength (см.
 * ops/DEVIATIONS.md, фаза 6). Поле `since` в А.5 иллюстративное ("3 недели
 * назад"); точную длительность восстановить нельзя, поэтому используется
 * нейтральная фраза вместо выдуманного числа (что противоречило бы 7.8.6 —
 * не сочинять то, чего нет во входных данных, тот же принцип применён и к
 * данным ДЛЯ модели, не только к её ответу).
 */
export interface AversionSummaryWithId extends AversionSummary {
  id: string;
}

export async function fetchAversionsSummary(pool: Pool, creatureId: string): Promise<AversionSummaryWithId[]> {
  const result = await pool.query<{ id: string; name: string; strength: number }>(
    `SELECT c.id, c.name, a.strength FROM aversions a JOIN creatures c ON c.id = a.object_id WHERE a.subject_id = $1`,
    [creatureId],
  );
  return result.rows.map((r) => ({ id: r.id, name: r.name, strength: r.strength, since: "неизвестно когда" }));
}

export async function fetchSignalHistory(pool: Pool, creatureId: string, limit = 10): Promise<SignalHistoryEntry[]> {
  const tolerance = getConstants().signaling.signal_honesty_tolerance;
  const result = await pool.query<{ type: string; tick: string | number; true_state: number; claimed_state: number; outcome: string }>(
    `SELECT type, tick, true_state, claimed_state, outcome FROM signals
     WHERE sender_id = $1 AND outcome != 'pending' ORDER BY created_at DESC LIMIT $2`,
    [creatureId, limit],
  );
  return result.rows.map((r) => ({
    type: r.type,
    tick: Number(r.tick),
    honest: Math.abs(r.true_state - r.claimed_state) <= tolerance,
    outcome: r.outcome as SignalHistoryEntry["outcome"],
    note: r.outcome === "disconfirmed" ? "сигнал не подтвердился" : "сигнал подтвердился",
  }));
}

export interface DeceivedByEntryWithId extends DeceivedByEntry {
  id: string;
}

export async function fetchDeceivedBy(pool: Pool, creatureId: string): Promise<DeceivedByEntryWithId[]> {
  const result = await pool.query<{ id: string; name: string; type: string; times: string }>(
    `
    SELECT c.id, c.name, s.type, count(*)::int AS times
    FROM signals s
    JOIN creatures c ON c.id = s.sender_id
    WHERE $1 = ANY(s.receivers) AND s.outcome = 'disconfirmed'
    GROUP BY c.id, c.name, s.type
    `,
    [creatureId],
  );
  return result.rows.map((r) => ({ id: r.id, name: r.name, type: r.type, times: Number(r.times) }));
}

export interface ReflectionRowInsert {
  creatureId: string;
  kind: ReflectionKind;
  mergedEpisodeIds: string[];
  request: unknown;
}

export async function insertQueuedReflection(pool: Pool, row: ReflectionRowInsert): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO reflections (creature_id, kind, status, merged_episode_ids, request) VALUES ($1, $2, 'queued', $3, $4) RETURNING id`,
    [row.creatureId, row.kind, row.mergedEpisodeIds, JSON.stringify(row.request)],
  );
  return result.rows[0].id;
}

/**
 * Пустая фоновая рефлексия: нет непоглощённых эпизодов — LLM не вызываем,
 * но пишем строку reflections, чтобы NOT EXISTS в findDueBackgroundCandidates
 * уважал interval и воркер не крутился вхолостую каждые N минут.
 */
export async function insertSkippedEmptyBackground(pool: Pool, creatureId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO reflections (creature_id, kind, status, merged_episode_ids, request, response)
     VALUES ($1, 'background', 'discarded', '{}', $2, $3) RETURNING id`,
    [creatureId, JSON.stringify({ skipped: "empty_background" }), JSON.stringify({ skipped: true, reason: "empty_background" })],
  );
  return result.rows[0].id;
}

export async function markReflectionSent(pool: Pool, id: string, response: unknown): Promise<void> {
  await pool.query(`UPDATE reflections SET status = 'sent', response = $2 WHERE id = $1`, [id, JSON.stringify(response)]);
}

/**
 * `rawResponse` (если есть) сохраняется в response — иначе после невалидного
 * ответа (7.3: "1 ретрай -> discard") в БД не остаётся никакого следа ТОГО,
 * что именно ответила модель, и разобрать причину систематических отказов
 * валидации (диагностика фазы 6) стало бы невозможно.
 */
export async function markReflectionFailed(pool: Pool, id: string, rawResponse?: string, stopReason?: string): Promise<void> {
  await pool.query(`UPDATE reflections SET status = 'failed', response = $2 WHERE id = $1`, [
    id,
    rawResponse !== undefined ? JSON.stringify({ raw: rawResponse, ...(stopReason ? { stop_reason: stopReason } : {}) }) : null,
  ]);
}

export interface QueuedReflectionRow {
  id: string;
  creature_id: string;
  kind: ReflectionKind;
  merged_episode_ids: string[];
  request: unknown;
  response: unknown | null;
  status: "queued" | "sent";
  created_at: string;
}

/**
 * Очередь к обработке: `queued` (ещё не звонили LLM) и `sent` (ответ сохранён,
 * но apply не завершился — crash recovery без повторного LLM).
 */
export async function fetchPendingQueuedReflections(pool: Pool): Promise<QueuedReflectionRow[]> {
  const result = await pool.query<QueuedReflectionRow>(
    `SELECT id, creature_id, kind, merged_episode_ids, request, response, status, created_at
     FROM reflections
     WHERE status IN ('queued', 'sent')
     ORDER BY created_at ASC`,
  );
  return result.rows;
}

export async function fetchWorldTick(pool: Pool): Promise<number> {
  const result = await pool.query<{ tick: string }>(`SELECT tick FROM world_clock WHERE id = 1`);
  return Number(result.rows[0]?.tick ?? 0);
}
