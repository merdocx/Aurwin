import { describe, expect, it } from "vitest";
import { DayNightCycle, getWorldConstants, perceptionRadius } from "../src/world/index.js";

describe("суточный цикл (7.10, А.10)", () => {
  it("длительность внутренних суток в тиках соответствует ~3.4 реального часа при визуальном тике 2 сек", () => {
    const { visual_tick_seconds, inner_day_real_hours } = getWorldConstants().time;
    const cycle = new DayNightCycle();
    const expectedTicks = Math.round((inner_day_real_hours * 3600) / visual_tick_seconds);
    expect(cycle.ticksPerDay()).toBe(expectedTicks);
  });

  it("первая половина суток — день, вторая половина — ночь", () => {
    const cycle = new DayNightCycle();
    const ticksPerDay = cycle.ticksPerDay();

    expect(cycle.phase()).toBe("day");

    for (let i = 0; i < ticksPerDay / 2 - 1; i += 1) cycle.tick();
    expect(cycle.phase()).toBe("day");

    cycle.tick();
    expect(cycle.phase()).toBe("night");

    for (let i = 0; i < ticksPerDay / 2 - 1; i += 1) cycle.tick();
    expect(cycle.phase()).toBe("night");

    cycle.tick(); // ровно ticksPerDay тиков спустя старта -> новые сутки, снова день
    expect(cycle.phase()).toBe("day");
  });

  it("цикл день/ночь повторяется бесконечно (несколько суток подряд)", () => {
    const cycle = new DayNightCycle();
    const ticksPerDay = cycle.ticksPerDay();
    const phases: string[] = [];

    for (let day = 0; day < 3; day += 1) {
      for (let t = 0; t < ticksPerDay; t += 1) {
        phases.push(cycle.phase());
        cycle.tick();
      }
    }

    const dayCount = phases.filter((p) => p === "day").length;
    const nightCount = phases.filter((p) => p === "night").length;
    expect(dayCount).toBe(nightCount);
  });

  it("ночью радиус восприятия меньше дневного согласно константам (пингвин и касатка)", () => {
    const constants = getWorldConstants().day_night.perception_radius;

    expect(perceptionRadius("penguin", "day", false)).toBe(constants.penguin.day);
    expect(perceptionRadius("penguin", "night", false)).toBe(constants.penguin.night);
    expect(perceptionRadius("penguin", "night", false)).toBeLessThan(
      perceptionRadius("penguin", "day", false),
    );

    expect(perceptionRadius("orca", "day", false)).toBe(constants.orca.day);
    expect(perceptionRadius("orca", "night", false)).toBe(constants.orca.night);
    expect(perceptionRadius("orca", "night", false)).toBeLessThan(
      perceptionRadius("orca", "day", false),
    );
  });

  it("спящее существо воспринимает мир слабее бодрствующего (полусон касаток мягче полного гашения у пингвина)", () => {
    const asleepMultiplier = getWorldConstants().day_night.asleep_perception_multiplier;

    const penguinAwake = perceptionRadius("penguin", "day", false);
    const penguinAsleep = perceptionRadius("penguin", "day", true);
    expect(penguinAsleep).toBeCloseTo(penguinAwake * asleepMultiplier.penguin, 9);
    expect(penguinAsleep).toBeLessThan(penguinAwake);

    const orcaAwake = perceptionRadius("orca", "day", false);
    const orcaAsleep = perceptionRadius("orca", "day", true);
    expect(orcaAsleep).toBeCloseTo(orcaAwake * asleepMultiplier.orca, 9);

    // Полусон (orca ×0.5) оставляет больше восприятия, чем глубокий сон пингвина (×0.1).
    expect(asleepMultiplier.orca).toBeGreaterThan(asleepMultiplier.penguin);
  });
});
