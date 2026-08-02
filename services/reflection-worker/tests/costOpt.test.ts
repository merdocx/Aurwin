import { describe, expect, it } from "vitest";
import { estimateCostUsd, modelForEvent } from "../src/anthropic.js";
import { getConstants } from "../src/constants.js";

describe("LLM cost opt: model routing + batch accounting", () => {
  it("modelForEvent: birth/hunt_success/bond_broken → Haiku; friend_died/bond_formed/vehi → Sonnet; смесь → Sonnet", () => {
    const { background, event } = getConstants().reflection.models;
    expect(modelForEvent(["birth"])).toBe(background);
    expect(modelForEvent(["hunt_success"])).toBe(background);
    expect(modelForEvent(["bond_broken"])).toBe(background);
    expect(modelForEvent(["friend_died"])).toBe(event);
    expect(modelForEvent(["bond_formed"])).toBe(event);
    expect(modelForEvent(["matured", "birth"])).toBe(event);
  });

  it("estimateCostUsd: Batch API применяет множитель ~0.5 к list-цене", () => {
    const model = getConstants().reflection.models.background;
    const list = estimateCostUsd(model, 1_000_000, 0);
    const batch = estimateCostUsd(model, 1_000_000, 0, { batch: true });
    expect(list).toBeGreaterThan(0);
    expect(batch).toBeCloseTo(list * 0.5, 10);
  });
});
