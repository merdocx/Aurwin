// reflection-worker — очередь LLM-рефлексий (ТЗ А.1, 7.3). Фаза 6 «Сознание».
//
// ВАЖНО (CLAUDE.md, «Незыблемые правила», п.7): до фазы 6 рефлексия была
// только замокана (см. services/sim-engine/src/sim/reflection.ts —
// generateMockReflection остаётся отдельным механизмом для тиков без
// доступа к БД/сети, например `npm run simulate --fast`; он НЕ используется
// этим процессом). Этот процесс делает РЕАЛЬНЫЕ вызовы Anthropic API.
//
// Ключ ANTHROPIC_API_KEY читается ИСКЛЮЧИТЕЛЬНО из окружения (см.
// anthropic.ts::apiKey()) и нигде не логируется — ни здесь, ни в anthropic.ts.
//
// Симуляция никогда не блокируется на LLM-вызове (7.3): это ОТДЕЛЬНЫЙ
// процесс от sim-engine, взаимодействующий с ним только через общую БД
// (reflections/creatures/episodes/world_events) — sim-engine не импортирует
// и не ждёт ответа этого процесса ни в каком виде.

import { HttpAnthropicTransport } from "./anthropic.js";
import { createPool } from "./pool.js";
import { startMetricsServer } from "./metrics.js";
import { ReflectionWorker } from "./worker.js";

const POLL_INTERVAL_MS = Number(process.env.REFLECTION_POLL_INTERVAL_MS ?? 30_000);

console.log("[reflection-worker] запуск очереди LLM-рефлексий (фаза 6 «Сознание»)");

if (!process.env.ANTHROPIC_API_KEY) {
  // Не бросаем — деградация (7.3): очередь просто будет копиться (каждый
  // вызов упадёт транспортной ошибкой, что и является штатным путём
  // отработки недоступности API), а не останавливать процесс/симуляцию.
  console.warn("[reflection-worker] ANTHROPIC_API_KEY не задан — вызовы LLM будут проваливаться и копиться в очереди (7.3)");
}

const pool = createPool();
const transport = new HttpAnthropicTransport();
const worker = new ReflectionWorker(pool, transport);

startMetricsServer();

let stopped = false;

async function loop(): Promise<void> {
  if (stopped) return;
  try {
    const summary = await worker.runPass();
    if (summary.attempted > 0) {
      console.log(
        `[reflection-worker] проход: applied=${summary.applied} discarded=${summary.discarded} failed=${summary.failed} transport_errors=${summary.transportErrors}`,
      );
    }
  } catch (err) {
    // Ошибка прохода (например, временная недоступность Postgres) не должна
    // останавливать процесс — очередь просто подождёт следующего прохода.
    console.error("[reflection-worker] ошибка в проходе очереди:", err);
  }
  if (!stopped) setTimeout(loop, POLL_INTERVAL_MS);
}

loop();

process.on("SIGTERM", () => {
  console.log("[reflection-worker] получен SIGTERM, завершение");
  stopped = true;
  pool.end().finally(() => process.exit(0));
});
