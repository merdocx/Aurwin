import type { AnthropicTransport, BatchItem, BatchResultItem, MessageCallResult } from "../src/anthropic.js";
import type { ReflectionRequestPayload } from "../src/types.js";

/**
 * Фейковый транспорт Anthropic API для тестов (нет реального
 * ANTHROPIC_API_KEY в среде разработки — см. ops/DEVIATIONS.md, фаза 6).
 * Реализует ТОТ ЖЕ интерфейс AnthropicTransport, что и HttpAnthropicTransport,
 * поэтому упражняет РЕАЛЬНЫЙ код queue.ts/worker.ts/validate.ts/apply.ts —
 * подменяется только сетевой слой (anthropic.ts).
 */
export class FakeAnthropicTransport implements AnthropicTransport {
  /** Включить, чтобы имитировать полную недоступность API (7.3, деградация). */
  down = false;
  messageCalls: string[] = [];
  lastBatchItems: BatchItem[] = [];
  batchCallCount = 0;

  constructor(private respond: (userContent: string) => string) {}

  async createMessage(_model: string, userContent: string): Promise<MessageCallResult> {
    this.messageCalls.push(userContent);
    if (this.down) throw new Error("[fake] симулированная сетевая недоступность Anthropic API");
    return { text: this.respond(userContent), inputTokens: 500, outputTokens: 200 };
  }

  async createBatch(_model: string, items: BatchItem[]): Promise<string> {
    this.batchCallCount += 1;
    this.lastBatchItems = items;
    if (this.down) throw new Error("[fake] симулированная сетевая недоступность Anthropic API (batch create)");
    return "fake-batch-id";
  }

  async pollBatch(_batchId: string, _timeoutMs: number, _pollIntervalMs: number): Promise<BatchResultItem[]> {
    if (this.down) throw new Error("[fake] симулированная сетевая недоступность Anthropic API (batch poll)");
    return this.lastBatchItems.map((item) => ({
      customId: item.customId,
      succeeded: true,
      text: this.respond(item.userContent),
      inputTokens: 500,
      outputTokens: 200,
    }));
  }
}

/**
 * "Честный" ответчик (для позитивных сценариев, включая гейт-тест 7.8.6):
 * читает РЕАЛЬНЫЙ payload запроса и строит ответ строго из того, что в нём
 * есть — narrative_facts и intentions ссылаются только на переданные факты/
 * зоны/имена, поэтому такой ответ ВСЕГДА проходит честность/валидацию.
 */
export function buildGroundedResponse(userContent: string): string {
  const payload = JSON.parse(userContent) as ReflectionRequestPayload;
  const facts: string[] = [];
  let traitDelta = 0.02;

  for (const episode of payload.new_episodes) {
    if (episode.type === "friend_died") {
      facts.push(`Потерял(а) ${episode.who}`);
      traitDelta = -0.05; // осторожнее после потери
    }
  }
  if (facts.length === 0 && payload.new_episodes.length > 0) {
    facts.push(`Пережил(а): ${payload.new_episodes[0].context}`);
  }
  if (facts.length === 0) facts.push("Ничего особенного не произошло");

  const worstZone = Object.entries(payload.habits_summary).sort((a, b) => a[1] - b[1])[0];
  const intentions =
    worstZone && worstZone[1] < 0
      ? [{ text: `держаться подальше от ${worstZone[0]}`, effect: { zone_penalty: { [worstZone[0]]: 0.4 } } }]
      : [{ text: "жить как раньше", effect: {} }];

  return JSON.stringify({
    narrative: `Я ${payload.creature.name}. ${facts.join(". ")}. Я продолжаю жить своей жизнью.`,
    narrative_facts: facts.slice(0, 3),
    trait_deltas: { caution: traitDelta > 0 ? traitDelta : -traitDelta, courage: traitDelta },
    weight_deltas: {},
    intentions,
  });
}
