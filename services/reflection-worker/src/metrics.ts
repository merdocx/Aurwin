import http from "node:http";
import client from "prom-client";
import type { Pool } from "pg";
import { noteLlmSpend } from "./budgetGate.js";
import { fetchReflectionStalenessBySpecies, fetchReflectionStatusCounts } from "./db.js";

/**
 * Экспорт метрик LLM-рефлексии (ТЗ 6.1 "Метрики LLM", А.7, фаза 7
 * «Эксплуатация»).
 *
 * `recordLlmCall` вызывается из РЕАЛЬНОГО компонента фазы 6
 * (`services/reflection-worker/src/worker.ts`, каждый завершённый вызов
 * Anthropic API — обычный Messages API для событийной рефлексии и Batch API
 * для фоновой) — не из заглушки. Alert-правила А.7 (доля ошибок LLM >
 * 50%/час, расход > 2х плана) опираются на эти же счётчики и потому
 * отражают фактическую боевую нагрузку reflection-worker, а не заготовку.
 */

const register = new client.Registry();
client.collectDefaultMetrics({ register });

export type ReflectionKind = "background" | "event";
export type CallStatus = "ok" | "error";

const llmCalls = new client.Counter({
  name: "aurwin_llm_calls_total",
  help: "Вызовы LLM-рефлексии по типу/модели/исходу (7.3, 7.6, А.7: доля ошибок > 50%/час)",
  labelNames: ["type", "model", "status"],
  registers: [register],
});

const llmCostUsd = new client.Counter({
  name: "aurwin_llm_cost_usd_total",
  help: "Накопленная стоимость вызовов LLM в USD (А.7, А.9: план ~$0.50/сутки, алёрт > 2х)",
  labelNames: ["type", "model"],
  registers: [register],
});

const llmLatencySeconds = new client.Histogram({
  name: "aurwin_llm_latency_seconds",
  help: "Латентность вызова LLM-рефлексии, сек",
  labelNames: ["type", "model"],
  buckets: [0.2, 0.5, 1, 2, 5, 10, 20, 40, 80],
  registers: [register],
});

const reflectionQueueByStatus = new client.Gauge({
  name: "aurwin_reflection_queue_by_status",
  help: "Текущее число строк reflections по статусу (queued/sent/applied/discarded/failed)",
  labelNames: ["status"],
  registers: [register],
});

const reflectionStalenessHours = new client.Gauge({
  name: "aurwin_reflection_staleness_hours",
  help: "Сколько часов прошло с последней применённой рефлексии у живых существ (avg/max по видам)",
  labelNames: ["species", "kind"],
  registers: [register],
});

export interface LlmCallRecord {
  type: ReflectionKind;
  model: string;
  status: CallStatus;
  latencySeconds: number;
  costUsd: number;
}

/** Вызывается при каждом завершённом вызове Anthropic API. */
export function recordLlmCall(record: LlmCallRecord): void {
  llmCalls.inc({ type: record.type, model: record.model, status: record.status });
  llmCostUsd.inc({ type: record.type, model: record.model }, record.costUsd);
  llmLatencySeconds.observe({ type: record.type, model: record.model }, record.latencySeconds);
  noteLlmSpend(record.costUsd);
}

export async function syncReflectionHealthMetrics(pool: Pool): Promise<void> {
  const [statusCounts, staleness] = await Promise.all([fetchReflectionStatusCounts(pool), fetchReflectionStalenessBySpecies(pool)]);
  for (const status of ["queued", "sent", "applied", "discarded", "failed"] as const) {
    reflectionQueueByStatus.set({ status }, statusCounts.get(status) ?? 0);
  }
  for (const row of staleness) {
    reflectionStalenessHours.set({ species: row.species, kind: "avg" }, row.avgHours);
    reflectionStalenessHours.set({ species: row.species, kind: "max" }, row.maxHours);
  }
}

/** Экспортирован для тестов (services/reflection-worker/tests/metrics.test.ts). */
export { register };

export function startMetricsServer(): http.Server {
  const port = Number(process.env.METRICS_PORT ?? 9465);
  const server = http.createServer((req, res) => {
    if (req.url !== "/metrics") {
      res.writeHead(404);
      res.end();
      return;
    }
    register
      .metrics()
      .then((body) => {
        res.writeHead(200, { "Content-Type": register.contentType });
        res.end(body);
      })
      .catch((err) => {
        res.writeHead(500);
        res.end(String(err));
      });
  });
  server.listen(port, () => console.log(`[reflection-worker] метрики Prometheus: http://0.0.0.0:${port}/metrics`));
  return server;
}
