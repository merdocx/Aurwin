import { describe, expect, it } from "vitest";
import { findUngroundedNames, validateReflectionResponse, type ValidationContext } from "../src/validate.js";

function baseCtx(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    knownZones: new Set(["main_ice", "north_bay", "south_shallows", "open_water", "far_ice"]),
    nameToId: new Map([
      ["Тико", "self-id"],
      ["Пин", "friend-id"],
    ]),
    ...overrides,
  };
}

function validResponse(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    narrative: "Я потерял подругу Пин у северной бухты. Теперь я осторожнее.",
    narrative_facts: ["Потерял подругу Пин", "Стал осторожнее у северной бухты"],
    trait_deltas: { courage: -0.05, caution: 0.07 },
    weight_deltas: { "w_need.social": 0.02 },
    intentions: [{ text: "избегать северной бухты", effect: { zone_penalty: { north_bay: 0.4 } } }],
    ...overrides,
  });
}

describe("validate.ts: контракт выхода А.5 — базовая форма", () => {
  it("принимает корректный ответ и возвращает разрешённые дельты/намерения", () => {
    const result = validateReflectionResponse(validResponse(), baseCtx());
    expect(result.ok).toBe(true);
    expect(result.value?.traitDeltas.courage).toBeCloseTo(-0.05, 6);
    expect(result.value?.intentions[0].effect.zone_penalty?.north_bay).toBeCloseTo(0.4, 6);
  });

  it("отклоняет невалидный JSON", () => {
    const result = validateReflectionResponse("это не json{", baseCtx());
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("invalid_json");
  });

  it("отклоняет narrative длиннее лимита слов", () => {
    const longNarrative = Array.from({ length: 200 }, () => "слово").join(" ");
    const result = validateReflectionResponse(validResponse({ narrative: longNarrative }), baseCtx());
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("narrative"))).toBe(true);
  });

  it("отклоняет дельту черты вне диапазона ±0.1", () => {
    const result = validateReflectionResponse(validResponse({ trait_deltas: { courage: 0.5 } }), baseCtx());
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("trait_deltas"))).toBe(true);
  });

  it("отклоняет неизвестную черту в trait_deltas", () => {
    const result = validateReflectionResponse(validResponse({ trait_deltas: { wisdom: 0.05 } }), baseCtx());
    expect(result.ok).toBe(false);
  });

  it("отклоняет дельту веса вне диапазона ±0.05", () => {
    const result = validateReflectionResponse(validResponse({ weight_deltas: { w_trait: 0.2 } }), baseCtx());
    expect(result.ok).toBe(false);
  });

  it("отклоняет неизвестный путь веса", () => {
    const result = validateReflectionResponse(validResponse({ weight_deltas: { w_charisma: 0.01 } }), baseCtx());
    expect(result.ok).toBe(false);
  });

  it("принимает валидные пути w_need.* и hunt_attractiveness.*", () => {
    const result = validateReflectionResponse(
      validResponse({ weight_deltas: { "w_need.hunger": 0.03, "hunt_attractiveness.w_vigor": -0.02 } }),
      baseCtx(),
    );
    expect(result.ok).toBe(true);
    expect(result.value?.weightDeltas["hunt_attractiveness.w_vigor"]).toBeCloseTo(-0.02, 6);
  });

  it("отклоняет больше intentions, чем max_intentions (3)", () => {
    const many = [0, 1, 2, 3].map((i) => ({ text: `намерение ${i}`, effect: {} }));
    const result = validateReflectionResponse(validResponse({ intentions: many }), baseCtx());
    expect(result.ok).toBe(false);
  });

  it("отклоняет effect с ключом вне белого списка", () => {
    const result = validateReflectionResponse(
      validResponse({ intentions: [{ text: "x", effect: { betray_creature: { creature: "Пин", value: 1 } } }] }),
      baseCtx(),
    );
    expect(result.ok).toBe(false);
  });

  it("отклоняет zone_penalty на несуществующую зону", () => {
    const result = validateReflectionResponse(
      validResponse({ intentions: [{ text: "x", effect: { zone_penalty: { atlantis: 0.3 } } }] }),
      baseCtx(),
    );
    expect(result.ok).toBe(false);
  });

  it("отклоняет approach_bonus на существо, которого нет во входных данных этого запроса (7.8.6/А.5)", () => {
    const result = validateReflectionResponse(
      validResponse({ intentions: [{ text: "держаться Никиты", effect: { approach_bonus: { creature: "Никита", value: 0.3 } } }] }),
      baseCtx(),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("несуществующее существо"))).toBe(true);
  });

  it("разрешает approach_bonus на известное имя и резолвит его в id", () => {
    const result = validateReflectionResponse(
      validResponse({ intentions: [{ text: "держаться Пин", effect: { approach_bonus: { creature: "Пин", value: 0.3 } } }] }),
      baseCtx(),
    );
    expect(result.ok).toBe(true);
    expect(result.value?.intentions[0].effect.approach_bonus?.creatureId).toBe("friend-id");
  });

  it("отклоняет narrative_facts длиннее max_narrative_facts", () => {
    const facts = Array.from({ length: 10 }, (_, i) => `факт ${i}`);
    const result = validateReflectionResponse(validResponse({ narrative_facts: facts }), baseCtx());
    expect(result.ok).toBe(false);
  });
});

describe("validate.ts: честность повествования (7.8.6) — findUngroundedNames", () => {
  it("не флагает известные имена", () => {
    const ungrounded = findUngroundedNames("Я встретил Пин у бухты.", new Set(["Тико", "Пин"]));
    expect(ungrounded).toHaveLength(0);
  });

  it("флагает полностью выдуманное имя, отсутствующее во входных данных", () => {
    const ungrounded = findUngroundedNames("Я спас Никиту от касатки.", new Set(["Тико", "Пин"]));
    expect(ungrounded).toContain("Никиту");
  });

  it("допускает склонение известного имени (общий префикс)", () => {
    // "Пину" — дательный падеж от "Пин", тот же корень.
    const ungrounded = findUngroundedNames("Я отдал рыбу Пину.", new Set(["Пин"]));
    expect(ungrounded).toHaveLength(0);
  });

  it("отклоняет весь ответ, если narrative упоминает несуществующее имя", () => {
    const result = validateReflectionResponse(
      validResponse({ narrative: "Я спас Никиту от касатки, хотя этого не было." }),
      baseCtx(),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("7.8.6"))).toBe(true);
  });
});
