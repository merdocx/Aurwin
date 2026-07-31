import http from "node:http";
import client from "prom-client";

/**
 * Экспорт метрик LLM-рефлексии (ТЗ 6.1 "Метрики LLM", А.7, фаза 7
 * «Эксплуатация»).
 *
 * ВАЖНО (см. ops/DEVIATIONS.md, фаза 7): фаза 6 «Сознание» — очередь
 * реальных вызовов Anthropic API — не реализована ни в одном предыдущем
 * коммите; reflection-worker/src/index.ts на момент фазы 7 остаётся
 * заготовкой фазы 1 (мокнутая рефлексия целиком живёт в sim-engine, см.
 * sim/reflection.ts:generateMockReflection). Эти метрики и alert-правила
 * (А.7: доля ошибок LLM > 50%/час, расход > 2х плана) поэтому написаны и
 * протестированы как ГОТОВАЯ инфраструктура, но будут показывать нули до
 * тех пор, пока фаза 6 не подключит реальные вызовы через `recordLlmCall`.
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
  help: "Накопленная стоимость вызовов LLM в USD (А.7, А.9: план ~$0.40/сутки, алёрт > 2х)",
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

export interface LlmCallRecord {
  type: ReflectionKind;
  model: string;
  status: CallStatus;
  latencySeconds: number;
  costUsd: number;
}

/** Вызывается из будущей реализации фазы 6 при каждом завершённом вызове Anthropic API. */
export function recordLlmCall(record: LlmCallRecord): void {
  llmCalls.inc({ type: record.type, model: record.model, status: record.status });
  llmCostUsd.inc({ type: record.type, model: record.model }, record.costUsd);
  llmLatencySeconds.observe({ type: record.type, model: record.model }, record.latencySeconds);
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
