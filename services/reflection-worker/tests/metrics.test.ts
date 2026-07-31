import { beforeEach, describe, expect, it } from "vitest";
import { recordLlmCall, register } from "../src/metrics.js";

/**
 * Реальных вызовов Anthropic API в этом процессе пока нет (фаза 6 не
 * реализована — см. ops/DEVIATIONS.md, фаза 7). Тест проверяет саму
 * инфраструктуру метрик — recordLlmCall() — контракт, которым будущая
 * реализация фазы 6 обязана воспользоваться, чтобы алёрты А.7 (доля ошибок
 * LLM > 50%/час, расход > 2х плана) заработали на реальных данных.
 */
describe("reflection-worker metrics: аккаунтинг вызовов LLM (6.1, А.7)", () => {
  beforeEach(() => {
    register.resetMetrics();
  });

  it("recordLlmCall инкрементирует счётчик вызовов по типу/модели/исходу", async () => {
    recordLlmCall({ type: "background", model: "claude-haiku-4-5", status: "ok", latencySeconds: 1.2, costUsd: 0.001 });
    recordLlmCall({ type: "event", model: "claude-sonnet-5", status: "error", latencySeconds: 3.4, costUsd: 0 });

    const calls = await register.getSingleMetric("aurwin_llm_calls_total")?.get();
    const ok = calls?.values.find((v) => v.labels.type === "background" && v.labels.status === "ok");
    const errored = calls?.values.find((v) => v.labels.type === "event" && v.labels.status === "error");
    expect(ok?.value).toBe(1);
    expect(errored?.value).toBe(1);
  });

  it("recordLlmCall накапливает стоимость и латентность", async () => {
    recordLlmCall({ type: "background", model: "claude-haiku-4-5", status: "ok", latencySeconds: 1, costUsd: 0.002 });
    recordLlmCall({ type: "background", model: "claude-haiku-4-5", status: "ok", latencySeconds: 1, costUsd: 0.003 });

    const cost = await register.getSingleMetric("aurwin_llm_cost_usd_total")?.get();
    const entry = cost?.values.find((v) => v.labels.type === "background" && v.labels.model === "claude-haiku-4-5");
    expect(entry?.value).toBeCloseTo(0.005, 6);
  });
});
