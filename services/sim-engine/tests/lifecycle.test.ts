import { describe, expect, it } from "vitest";
import { ageStageFor, ageWeeksAt, maxAgeWeeksFor, oldAgeDeathProbabilityPerTick } from "../src/sim/lifecycle.js";
import { realDaysToTicks } from "../src/sim/time.js";

describe("lifecycle", () => {
  it("возраст в внутренних неделях растёт линейно с тиками (1 реальные сутки = 1 внутренняя неделя)", () => {
    const oneDayTicks = realDaysToTicks(1);
    expect(ageWeeksAt(0, oneDayTicks)).toBeCloseTo(1, 5);
    expect(ageWeeksAt(0, oneDayTicks * 2)).toBeCloseTo(2, 5);
  });

  it("возрастные стадии пингвина соответствуют А.10 (1.5/7/10 нед)", () => {
    expect(ageStageFor("penguin", 0)).toBe("juvenile");
    expect(ageStageFor("penguin", 1)).toBe("juvenile");
    expect(ageStageFor("penguin", 1.5)).toBe("adult");
    expect(ageStageFor("penguin", 6.9)).toBe("adult");
    expect(ageStageFor("penguin", 7)).toBe("old");
    expect(ageStageFor("penguin", 9.9)).toBe("old");
  });

  it("возрастные стадии касатки соответствуют А.10 (5/22/30 нед)", () => {
    expect(ageStageFor("orca", 4)).toBe("juvenile");
    expect(ageStageFor("orca", 5)).toBe("adult");
    expect(ageStageFor("orca", 21.9)).toBe("adult");
    expect(ageStageFor("orca", 22)).toBe("old");
  });

  it("максимальный возраст пингвина/касатки соответствует А.9/А.10", () => {
    expect(maxAgeWeeksFor("penguin")).toBe(10);
    expect(maxAgeWeeksFor("orca")).toBe(30);
  });

  it("вероятность смерти от старости = 0 до стадии 'старый'", () => {
    expect(oldAgeDeathProbabilityPerTick("penguin", 5)).toBe(0);
  });

  it("вероятность смерти от старости = 1 (гарантирована) на верхней границе", () => {
    expect(oldAgeDeathProbabilityPerTick("penguin", 10)).toBe(1);
    expect(oldAgeDeathProbabilityPerTick("penguin", 15)).toBe(1);
  });

  it("вероятность смерти от старости растёт монотонно внутри стадии 'старый'", () => {
    const early = oldAgeDeathProbabilityPerTick("penguin", 7.5);
    const mid = oldAgeDeathProbabilityPerTick("penguin", 8.5);
    const late = oldAgeDeathProbabilityPerTick("penguin", 9.5);
    expect(early).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(early);
    expect(late).toBeGreaterThan(mid);
    expect(late).toBeLessThan(1);
  });
});
