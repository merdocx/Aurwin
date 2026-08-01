import type { Pool } from "pg";
import { estimateCostUsd, modelFor, modelForEvent, type AnthropicTransport } from "./anthropic.js";
import { applyReflectionResult } from "./apply.js";
import { getConstants } from "./constants.js";
import { fetchPendingQueuedReflections, fetchWorldTick, markReflectionFailed, markReflectionSent, type QueuedReflectionRow } from "./db.js";
import { recordLlmCall } from "./metrics.js";
import { selectCandidates } from "./queue.js";
import { rebuildNameToId } from "./request.js";
import { validateReflectionResponse, type ValidatedReflection } from "./validate.js";
import type { ReflectionRequestPayload } from "./types.js";

/** Экспоненциальный бэкофф ретраев при недоступности API (7.3, деградация) — не константа баланса симуляции (А.9), а рабочий параметр процесса. */
const BACKOFF_BASE_MS = Number(process.env.REFLECTION_BACKOFF_BASE_MS ?? 5_000);
const BACKOFF_MAX_MS = Number(process.env.REFLECTION_BACKOFF_MAX_MS ?? 30 * 60_000);
const BATCH_POLL_TIMEOUT_MS = Number(process.env.REFLECTION_BATCH_POLL_TIMEOUT_MS ?? 10 * 60_000);
const BATCH_POLL_INTERVAL_MS = Number(process.env.REFLECTION_BATCH_POLL_INTERVAL_MS ?? 5_000);

export type ReflectionOutcome = "applied" | "discarded" | "failed" | "transport_error";

export interface PassSummary {
  attempted: number;
  applied: number;
  discarded: number;
  failed: number;
  transportErrors: number;
}

interface BackoffState {
  attempts: number;
  notBeforeMs: number;
}

/**
 * Оркестратор одного прохода очереди (7.3): отбирает кандидатов
 * (queue.ts), вызывает Anthropic (anthropic.ts), валидирует (validate.ts)
 * и применяет (apply.ts). При недоступности API строка `reflections`
 * ОСТАЁТСЯ 'queued' — это и есть "очередь копится" (7.3, деградация):
 * ничего не теряется, симуляция (отдельный процесс sim-engine) не знает и
 * не заботится о том, что LLM недоступен. Бэкофф — in-memory на процесс
 * воркера (переживает временную недоступность API в рамках одного запуска;
 * при рестарте воркера прогресс бэкоффа сбрасывается к базовой задержке —
 * это ослабление, а не потеря данных: строки остаются queued в БД, см.
 * ops/DEVIATIONS.md, фаза 6).
 */
export class ReflectionWorker {
  private backoff = new Map<string, BackoffState>();

  constructor(
    private pool: Pool,
    private transport: AnthropicTransport,
    private clock: () => number = Date.now,
  ) {}

  private isEligible(row: QueuedReflectionRow): boolean {
    const state = this.backoff.get(row.id);
    return !state || this.clock() >= state.notBeforeMs;
  }

  private recordTransportFailure(reflectionId: string): void {
    const prev = this.backoff.get(reflectionId) ?? { attempts: 0, notBeforeMs: 0 };
    const attempts = prev.attempts + 1;
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** (attempts - 1), BACKOFF_MAX_MS);
    this.backoff.set(reflectionId, { attempts, notBeforeMs: this.clock() + delay });
  }

  private clearBackoff(reflectionId: string): void {
    this.backoff.delete(reflectionId);
  }

  /** Только для тестов/диагностики. */
  backoffAttemptsFor(reflectionId: string): number {
    return this.backoff.get(reflectionId)?.attempts ?? 0;
  }

  private async validateAgainstRow(row: QueuedReflectionRow, text: string, stopReason?: string): Promise<ValidatedReflection | undefined> {
    const nameToId = await rebuildNameToId(this.pool, row.creature_id);
    const knownZones = new Set(Object.keys(getConstants().world.zones));
    const result = validateReflectionResponse(text, { nameToId, knownZones });
    if (!result.ok) {
      // Диагностика (не блокирует пайплайн, только видимость причин отказа
      // валидации — А.7 требует отслеживать долю ошибок LLM, а без деталей
      // "невалидный ответ" неотличим от сетевого сбоя в логах). stopReason
      // отдельно помечен: "max_tokens" — это ответ, ОБРЕЗАННЫЙ лимитом
      // токенов (см. anthropic.ts::MAX_OUTPUT_TOKENS), а не смысловая ошибка
      // модели — при приёмке фазы 7 это оказалось причиной подавляющего
      // большинства провалов валидации (см. ops/DEVIATIONS.md).
      const stopNote = stopReason ? ` [stop_reason=${stopReason}]` : "";
      console.warn(`[reflection-worker] невалидный ответ LLM для ${row.creature_id} (${row.kind})${stopNote}: ${result.errors.join("; ")}`);
    }
    return result.ok ? result.value : undefined;
  }

  private async attemptCall(
    model: string,
    kind: "event" | "background",
    userContent: string,
  ): Promise<{ ok: true; text: string; stopReason?: string } | { ok: false }> {
    const start = this.clock();
    try {
      const result = await this.transport.createMessage(model, userContent);
      recordLlmCall({
        type: kind,
        model,
        status: "ok",
        latencySeconds: (this.clock() - start) / 1000,
        costUsd: estimateCostUsd(model, result.inputTokens, result.outputTokens),
      });
      return { ok: true, text: result.text, stopReason: result.stopReason };
    } catch {
      recordLlmCall({ type: kind, model, status: "error", latencySeconds: (this.clock() - start) / 1000, costUsd: 0 });
      return { ok: false };
    }
  }

  private async finalizeApply(row: QueuedReflectionRow, validated: ValidatedReflection): Promise<"applied" | "discarded"> {
    await markReflectionSent(this.pool, row.id, validated);
    const tick = await fetchWorldTick(this.pool);
    const outcome = await applyReflectionResult(this.pool, {
      reflectionId: row.id,
      creatureId: row.creature_id,
      mergedEpisodeIds: row.merged_episode_ids,
      currentTick: tick,
      validated,
    });
    return outcome.applied ? "applied" : "discarded";
  }

  private async processEvent(row: QueuedReflectionRow): Promise<ReflectionOutcome> {
    const payload = row.request as ReflectionRequestPayload;
    const episodeTypes = (payload?.new_episodes ?? []).map((e) => e.type);
    const model = modelForEvent(episodeTypes);
    const first = await this.attemptCall(model, "event", JSON.stringify(row.request));
    if (!first.ok) {
      this.recordTransportFailure(row.id);
      return "transport_error";
    }
    this.clearBackoff(row.id);

    let validated = await this.validateAgainstRow(row, first.text, first.stopReason);
    let lastRawText = first.text;
    let lastStopReason = first.stopReason;
    if (!validated) {
      const retry = await this.attemptCall(model, "event", JSON.stringify(row.request));
      if (!retry.ok) {
        this.recordTransportFailure(row.id);
        return "transport_error";
      }
      lastRawText = retry.text;
      lastStopReason = retry.stopReason;
      validated = await this.validateAgainstRow(row, retry.text, retry.stopReason);
    }
    if (!validated) {
      await markReflectionFailed(this.pool, row.id, lastRawText, lastStopReason);
      return "failed";
    }
    return this.finalizeApply(row, validated);
  }

  private async processBackgroundBatch(rows: QueuedReflectionRow[]): Promise<Map<string, ReflectionOutcome>> {
    const outcomes = new Map<string, ReflectionOutcome>();
    if (rows.length === 0) return outcomes;
    const model = modelFor("background");

    let batchId: string;
    try {
      batchId = await this.transport.createBatch(
        model,
        rows.map((r) => ({ customId: r.id, userContent: JSON.stringify(r.request) })),
      );
    } catch {
      recordLlmCall({ type: "background", model, status: "error", latencySeconds: 0, costUsd: 0 });
      for (const row of rows) {
        this.recordTransportFailure(row.id);
        outcomes.set(row.id, "transport_error");
      }
      return outcomes;
    }

    let results;
    try {
      results = await this.transport.pollBatch(batchId, BATCH_POLL_TIMEOUT_MS, BATCH_POLL_INTERVAL_MS);
    } catch {
      recordLlmCall({ type: "background", model, status: "error", latencySeconds: 0, costUsd: 0 });
      for (const row of rows) {
        this.recordTransportFailure(row.id);
        outcomes.set(row.id, "transport_error");
      }
      return outcomes;
    }

    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const result of results) {
      const row = byId.get(result.customId);
      if (!row) continue;

      if (!result.succeeded || result.text === undefined) {
        // Ошибка НА УРОВНЕ ОДНОГО ЭЛЕМЕНТА batch (rate_limit/overloaded/
        // expired и т.п., Anthropic Batch API возвращает статус per-item) —
        // это сигнал временной недоступности ИМЕННО ДЛЯ ЭТОГО элемента, а не
        // окончательный провал валидации ответа. 7.3 (деградация) требует
        // "очередь копится и обрабатывается с экспоненциальными ретраями" —
        // раньше это НАВСЕГДА помечало reflections как 'failed' без единой
        // попытки повтора: на приёмке фазы 7 такие batch-ошибки оказались
        // 39 из 96 (41%) реальных отказов — то есть почти половина "провалов
        // валидации" вообще не были ответом модели, а обрывом на транспортном
        // уровне (см. ops/DEVIATIONS.md). Оставляем строку 'queued' + бэкофф,
        // тем же путём, что и полная недоступность API — следующий проход
        // подберёт кандидата снова.
        recordLlmCall({ type: "background", model, status: "error", latencySeconds: 0, costUsd: 0 });
        this.recordTransportFailure(row.id);
        outcomes.set(row.id, "transport_error");
        continue;
      }
      this.clearBackoff(row.id);
      recordLlmCall({
        type: "background",
        model,
        status: "ok",
        latencySeconds: 0,
        costUsd: estimateCostUsd(model, result.inputTokens ?? 0, result.outputTokens ?? 0, { batch: true }),
      });

      let validated = await this.validateAgainstRow(row, result.text, result.stopReason);
      let lastRawText = result.text;
      let lastStopReason = result.stopReason;
      if (!validated) {
        // 1 ретрай (7.3) — обычным (не batch) вызовом: это единичная
        // досылка для ОДНОГО существа, разворачивать ради нее ещё один batch
        // избыточно.
        const retry = await this.attemptCall(model, "background", JSON.stringify(row.request));
        if (retry.ok) {
          lastRawText = retry.text;
          lastStopReason = retry.stopReason;
          validated = await this.validateAgainstRow(row, retry.text, retry.stopReason);
        }
      }
      if (!validated) {
        await markReflectionFailed(this.pool, row.id, lastRawText, lastStopReason);
        outcomes.set(row.id, "failed");
        continue;
      }
      outcomes.set(row.id, await this.finalizeApply(row, validated));
    }

    // Строки batch API не вернул (не должно случаться штатно) остаются
    // 'queued' — подхватятся следующим проходом.
    return outcomes;
  }

  /** Один проход: отбор новых кандидатов + попытка обработать всё, что стоит в очереди (включая застрявшее). */
  async runPass(): Promise<PassSummary> {
    await selectCandidates(this.pool);
    const pending = await fetchPendingQueuedReflections(this.pool);
    const eligible = pending.filter((r) => this.isEligible(r));

    const summary: PassSummary = { attempted: 0, applied: 0, discarded: 0, failed: 0, transportErrors: 0 };
    const tally = (outcome: ReflectionOutcome) => {
      summary.attempted += 1;
      if (outcome === "applied") summary.applied += 1;
      else if (outcome === "discarded") summary.discarded += 1;
      else if (outcome === "failed") summary.failed += 1;
      else summary.transportErrors += 1;
    };

    for (const row of eligible.filter((r) => r.kind === "event")) {
      tally(await this.processEvent(row));
    }

    const backgroundOutcomes = await this.processBackgroundBatch(eligible.filter((r) => r.kind === "background"));
    for (const outcome of backgroundOutcomes.values()) tally(outcome);

    return summary;
  }
}
