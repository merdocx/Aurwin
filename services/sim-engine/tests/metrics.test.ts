import { beforeEach, describe, expect, it } from "vitest";
import { Simulation } from "../src/sim/simulation.js";
import { recordWorldEvent, register, setPopulationGauges } from "../src/metrics.js";
import type { WorldEvent } from "../src/sim/types.js";

async function metricValue(name: string, labels?: Record<string, string>): Promise<number | undefined> {
  const metric = await register.getSingleMetric(name)?.get();
  if (!metric) return undefined;
  if (!labels) return metric.values[0]?.value;
  const match = metric.values.find((v) => Object.entries(labels).every(([k, val]) => v.labels[k] === val));
  return match?.value;
}

describe("metrics: гейджи населения/навыков/сна (6.1, А.7)", () => {
  beforeEach(() => {
    register.resetMetrics();
  });

  it("aurwin_population отражает численность живых существ по видам", async () => {
    const sim = new Simulation(1);
    setPopulationGauges(sim);
    const penguins = sim.aliveCreatures().filter((c) => c.species === "penguin").length;
    const orcas = sim.aliveCreatures().filter((c) => c.species === "orca").length;
    expect(await metricValue("aurwin_population", { species: "penguin" })).toBe(penguins);
    expect(await metricValue("aurwin_population", { species: "orca" })).toBe(orcas);
  });

  it("aurwin_tick и aurwin_last_tick_timestamp_seconds обновляются", async () => {
    const sim = new Simulation(2);
    sim.tick();
    sim.tick();
    setPopulationGauges(sim);
    expect(await metricValue("aurwin_tick")).toBe(sim.currentTick);
    expect(await metricValue("aurwin_last_tick_timestamp_seconds")).toBeGreaterThan(0);
  });

  it("aurwin_births_total и aurwin_deaths_total зеркалят sim.acc", async () => {
    const sim = new Simulation(3);
    sim.acc.births.penguin = 5;
    sim.acc.deaths.orca.predation = 2;
    setPopulationGauges(sim);
    expect(await metricValue("aurwin_births_total", { species: "penguin" })).toBe(5);
    expect(await metricValue("aurwin_deaths_total", { species: "orca", cause: "predation" })).toBe(2);
  });
});

describe("metrics: продолжительность жизни и ночные смерти от хищника (6.1, 7.10)", () => {
  beforeEach(() => {
    register.resetMetrics();
  });

  it("recordWorldEvent(death) пишет наблюдение в гистограмму продолжительности жизни", async () => {
    const event: WorldEvent = {
      id: "e1",
      tick: 1000,
      type: "death",
      actorId: "c1",
      payload: { cause: "age", species: "penguin", bornAtTick: 0 },
    };
    recordWorldEvent(event, "day");
    const histogram = await register.getSingleMetric("aurwin_lifespan_weeks")?.get();
    const sumEntry = histogram?.values.find((v) => v.metricName?.endsWith("_sum") && v.labels.species === "penguin");
    expect(sumEntry?.value).toBeGreaterThan(0);
  });

  it("ночная смерть от хищника инкрементирует aurwin_night_predation_deaths_total, дневная — нет", async () => {
    const base: WorldEvent = { id: "e1", tick: 100, type: "death", actorId: "c1", payload: { cause: "predation", species: "penguin", bornAtTick: 0 } };
    recordWorldEvent(base, "night");
    expect(await metricValue("aurwin_night_predation_deaths_total")).toBe(1);
    recordWorldEvent({ ...base, id: "e2" }, "day");
    expect(await metricValue("aurwin_night_predation_deaths_total")).toBe(1);
  });
});
