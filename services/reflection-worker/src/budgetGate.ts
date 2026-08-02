import { getConstants } from "./constants.js";

/**
 * Скользящее окно фактического расхода LLM (USD) за 24ч — жёсткий стоп
 * очереди при `llm_daily_budget_usd` (А.9). In-memory: после рестарта
 * воркера окно пустое (краткий риск повторного разгона до суточного
 * event-капа); основной потолок — `event_global_limit_per_*` в БД.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000;

interface SpendEntry {
  atMs: number;
  usd: number;
}

const spends: SpendEntry[] = [];

function prune(nowMs: number): void {
  while (spends.length > 0 && nowMs - spends[0]!.atMs >= WINDOW_MS) {
    spends.shift();
  }
}

/** Учесть фактическую стоимость завершённого вызова (ok/error с cost>0). */
export function noteLlmSpend(usd: number, nowMs: number = Date.now()): void {
  if (!(usd > 0) || !Number.isFinite(usd)) return;
  spends.push({ atMs: nowMs, usd });
  prune(nowMs);
}

export function llmSpendLast24hUsd(nowMs: number = Date.now()): number {
  prune(nowMs);
  let sum = 0;
  for (const e of spends) sum += e.usd;
  return sum;
}

/** true → не ставить новые кандидаты и не слать новые LLM-вызовы. */
export function isLlmDailyBudgetExceeded(nowMs: number = Date.now()): boolean {
  const budget = getConstants().reflection.llm_daily_budget_usd;
  return llmSpendLast24hUsd(nowMs) >= budget;
}

/** Только для тестов. */
export function resetLlmSpendForTests(): void {
  spends.length = 0;
}
