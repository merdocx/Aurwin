import { describe, expect, it } from "vitest";

/** Контракт index.ts::needsInsert — birth и reintroduction требуют full upsert. */
function needsInsert(eventTypes: string[]): boolean {
  return eventTypes.some((t) => t === "birth" || t === "reintroduction");
}

describe("persist needsInsert", () => {
  it("full на birth и reintroduction, не на death", () => {
    expect(needsInsert(["death"])).toBe(false);
    expect(needsInsert(["birth"])).toBe(true);
    expect(needsInsert(["reintroduction"])).toBe(true);
    expect(needsInsert(["bond_formed", "reintroduction"])).toBe(true);
  });
});
