import { afterEach, describe, expect, it } from "vitest";
import {
  isLlmDailyBudgetExceeded,
  llmSpendLast24hUsd,
  noteLlmSpend,
  resetLlmSpendForTests,
} from "../src/budgetGate.js";
import { getConstants } from "../src/constants.js";

describe("budgetGate: жёсткий стоп llm_daily_budget_usd", () => {
  afterEach(() => {
    resetLlmSpendForTests();
  });

  it("суммирует spend за 24ч и срабатывает на пороге бюджета", () => {
    const budget = getConstants().reflection.llm_daily_budget_usd;
    const now = Date.now();
    noteLlmSpend(budget / 2, now);
    expect(isLlmDailyBudgetExceeded(now)).toBe(false);
    noteLlmSpend(budget / 2, now + 1);
    expect(llmSpendLast24hUsd(now + 1)).toBeCloseTo(budget, 6);
    expect(isLlmDailyBudgetExceeded(now + 1)).toBe(true);
  });

  it("выбрасывает записи старше 24ч", () => {
    const now = Date.now();
    noteLlmSpend(10, now - 25 * 60 * 60 * 1000);
    expect(llmSpendLast24hUsd(now)).toBe(0);
    expect(isLlmDailyBudgetExceeded(now)).toBe(false);
  });
});
