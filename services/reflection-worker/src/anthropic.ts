import { getConstants } from "./constants.js";
import { buildSystemPrompt } from "./prompt.js";
import type { ReflectionKind } from "./types.js";

const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
/**
 * Ответ рефлексии ограничен ~150 слов narrative + короткие структурные поля
 * (7.6: "выход ≈ 450 токенов") — НО это ориентир для типичного случая, не
 * жёсткий потолок: живой боевой прогон (приёмка фазы 7) показал, что при
 * 1024 токенах ~37% рефлексий проваливали валидацию, и почти ВСЕ провалы
 * оказались синтаксически незакрытым JSON, обрубленным на произвольном
 * символе — то есть моделью, упёршейся в max_tokens ДО того, как она успела
 * закрыть объект, а не невалидным по смыслу ответом. Корреляция с числом
 * слитых эпизодов в одном вызове (`new_episodes`, дебаунс 7.3 может слить
 * "все события" затяжного эпизода вроде разорения колонии — до 36 штук в
 * одном вызове на боевом прогоне) была явной, но даже вызовы БЕЗ новых
 * эпизодов (переписывание narrative + фактов + намерений с нуля) иногда
 * упирались в лимит — риск был системным, а не только для "многословных"
 * случаев. Anthropic биллит по РЕАЛЬНО сгенерированным токенам, а не по
 * значению потолка (см. `estimateCostUsd` ниже — использует `usage.
 * output_tokens` из ответа), поэтому щедрый запас здесь не увеличивает
 * стоимость типичного вызова ни на цент — расширяет только страховку от
 * обрезания. См. ops/DEVIATIONS.md.
 */
const MAX_OUTPUT_TOKENS = 4096;

export interface MessageCallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /**
   * `stop_reason` из ответа Anthropic (`"end_turn"`, `"max_tokens"`, ...) —
   * без него отличить обрезание по лимиту токенов от иной причины короткого/
   * невалидного ответа можно было только вручную считая байты обрубленного
   * JSON (именно так и был диагностирован дефект приёмки фазы 7, см.
   * ops/DEVIATIONS.md) — теперь это видно сразу в логе/`reflections.response`.
   */
  stopReason?: string;
}

export interface BatchItem {
  customId: string;
  userContent: string;
}

export interface BatchResultItem {
  customId: string;
  succeeded: boolean;
  text?: string;
  inputTokens?: number;
  outputTokens?: number;
  errorMessage?: string;
  /** См. MessageCallResult.stopReason — то же самое поле, для batch-ветки. */
  stopReason?: string;
}

/**
 * Абстракция над Anthropic API (7.5): событийная рефлексия — обычный
 * (не batch) вызов Messages API, так как привязана к конкретному моменту;
 * фоновая — через Batch API (не срочно, дешевле, 7.6). Интерфейс позволяет
 * подменить транспорт в тестах фейковым (детерминированным) без сети/ключа —
 * см. ops/DEVIATIONS.md, фаза 6: реального ANTHROPIC_API_KEY в среде
 * разработки нет, боевой HTTP-транспорт ниже не мог быть провалидирован
 * против реального API в этой сессии.
 */
export interface AnthropicTransport {
  createMessage(model: string, userContent: string): Promise<MessageCallResult>;
  /** Создаёт batch-задание, возвращает его id. */
  createBatch(model: string, items: BatchItem[]): Promise<string>;
  /** Опрашивает статус batch-задания до готовности (или до timeout) и возвращает результаты. */
  pollBatch(batchId: string, timeoutMs: number, pollIntervalMs: number): Promise<BatchResultItem[]>;
}

function apiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    // НЕ логируем значение ключа (CLAUDE.md, «Незыблемые правила», п.1-2) —
    // только факт отсутствия.
    throw new Error("ANTHROPIC_API_KEY не задан в окружении — LLM-вызов невозможен (CLAUDE.md, п.1-2, 7)");
  }
  return key;
}

function headers(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": apiKey(),
    "anthropic-version": ANTHROPIC_VERSION,
  };
}

/**
 * Системный блок с cache_control: ephemeral (7.5, "промпт-кэширование
 * общей системной части") — одинаков для всех вызовов ОДНОЙ модели, снижает
 * стоимость входных токенов повторяющегося префикса при последующих вызовах
 * в течение TTL кэша Anthropic.
 */
function systemBlock(): Array<{ type: "text"; text: string; cache_control: { type: "ephemeral" } }> {
  return [{ type: "text", text: buildSystemPrompt(), cache_control: { type: "ephemeral" } }];
}

export class HttpAnthropicTransport implements AnthropicTransport {
  async createMessage(model: string, userContent: string): Promise<MessageCallResult> {
    const response = await fetch(`${ANTHROPIC_API_BASE}/messages`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: systemBlock(),
        messages: [{ role: "user", content: userContent }],
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Anthropic Messages API: ${response.status} ${body.slice(0, 500)}`);
    }
    const json = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage: { input_tokens: number; output_tokens: number };
      stop_reason?: string;
    };
    const text = json.content.find((b) => b.type === "text")?.text ?? "";
    return { text, inputTokens: json.usage.input_tokens, outputTokens: json.usage.output_tokens, stopReason: json.stop_reason };
  }

  async createBatch(model: string, items: BatchItem[]): Promise<string> {
    const response = await fetch(`${ANTHROPIC_API_BASE}/messages/batches`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        requests: items.map((item) => ({
          custom_id: item.customId,
          params: {
            model,
            max_tokens: MAX_OUTPUT_TOKENS,
            system: systemBlock(),
            messages: [{ role: "user", content: item.userContent }],
          },
        })),
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Anthropic Batch API (create): ${response.status} ${body.slice(0, 500)}`);
    }
    const json = (await response.json()) as { id: string };
    return json.id;
  }

  async pollBatch(batchId: string, timeoutMs: number, pollIntervalMs: number): Promise<BatchResultItem[]> {
    const deadline = Date.now() + timeoutMs;
    let resultsUrl: string | undefined;
    while (Date.now() < deadline) {
      const response = await fetch(`${ANTHROPIC_API_BASE}/messages/batches/${batchId}`, { headers: headers() });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Anthropic Batch API (poll): ${response.status} ${body.slice(0, 500)}`);
      }
      const json = (await response.json()) as { processing_status: string; results_url: string | null };
      if (json.processing_status === "ended" && json.results_url) {
        resultsUrl = json.results_url;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    if (!resultsUrl) throw new Error(`Anthropic Batch API: задание ${batchId} не завершилось за отведённое время`);

    const resultsResponse = await fetch(resultsUrl, { headers: headers() });
    if (!resultsResponse.ok) throw new Error(`Anthropic Batch API (results): ${resultsResponse.status}`);
    const bodyText = await resultsResponse.text();
    return bodyText
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const row = JSON.parse(line) as {
          custom_id: string;
          result: {
            type: string;
            message?: {
              content: Array<{ type: string; text?: string }>;
              usage: { input_tokens: number; output_tokens: number };
              stop_reason?: string;
            };
            error?: { message?: string };
          };
        };
        if (row.result.type === "succeeded" && row.result.message) {
          const text = row.result.message.content.find((b) => b.type === "text")?.text ?? "";
          return {
            customId: row.custom_id,
            succeeded: true,
            text,
            inputTokens: row.result.message.usage.input_tokens,
            outputTokens: row.result.message.usage.output_tokens,
            stopReason: row.result.message.stop_reason,
          };
        }
        return { customId: row.custom_id, succeeded: false, errorMessage: row.result.error?.message ?? row.result.type };
      });
  }
}

export function modelFor(kind: ReflectionKind): string {
  return getConstants().reflection.models[kind];
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = getConstants().reflection.model_pricing_usd_per_million_tokens[model];
  if (!pricing) return 0;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}
