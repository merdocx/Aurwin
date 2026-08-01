import { describe, expect, it } from "vitest";
import { FishField, getWorldConstants } from "../src/world/index.js";

describe("плотность рыбы по кормовым зонам (А.10)", () => {
  it("стартует на потолке 1.0 в обеих кормовых зонах", () => {
    const fish = new FishField();
    expect(fish.getDensity("north_bay")).toBe(1.0);
    expect(fish.getDensity("south_shallows")).toBe(1.0);
  });

  it("восстанавливается до потолка 1.0 и не превышает его", () => {
    const fish = new FishField();
    fish.consume("north_bay", 0.5);
    expect(fish.getDensity("north_bay")).toBeCloseTo(0.5, 9);

    // Респавн north_bay = +0.04/тик (world.fish_respawn_per_tick) — хватит на
    // много тиков с запасом, чтобы гарантированно упереться в потолок.
    for (let i = 0; i < 1000; i += 1) fish.tick();

    expect(fish.getDensity("north_bay")).toBe(1.0);
    expect(fish.getDensity("south_shallows")).toBe(1.0);
  });

  it("истощается локально: кормёжка в одной зоне не трогает плотность другой", () => {
    const fish = new FishField();
    fish.consume("north_bay", 0.9);

    expect(fish.getDensity("north_bay")).toBeCloseTo(0.1, 9);
    expect(fish.getDensity("south_shallows")).toBe(1.0);
  });

  it("consume не уходит в минус ниже нуля даже при чрезмерном запросе", () => {
    const fish = new FishField();
    const consumed = fish.consume("north_bay", 5);
    expect(consumed).toBeCloseTo(1.0, 9);
    expect(fish.getDensity("north_bay")).toBe(0);

    const consumedAgain = fish.consume("north_bay", 0.02);
    expect(consumedAgain).toBe(0);
    expect(fish.getDensity("north_bay")).toBe(0);
  });

  it("один приём пищи расходует 0.02 плотности локально (А.10)", () => {
    const fish = new FishField();
    const consumed = fish.consume("south_shallows", 0.02);
    expect(consumed).toBeCloseTo(0.02, 9);
    expect(fish.getDensity("south_shallows")).toBeCloseTo(0.98, 9);
  });

  it("respawn per tick соответствует асимметрии north_bay/south_shallows из конфига", () => {
    const rates = getWorldConstants().world.fish_respawn_per_tick;
    const fish = new FishField();
    fish.consume("north_bay", 0.5);
    fish.consume("south_shallows", 0.5);
    fish.tick();

    expect(fish.getDensity("north_bay")).toBeCloseTo(0.5 + rates.north_bay, 9);
    expect(fish.getDensity("south_shallows")).toBeCloseTo(0.5 + rates.south_shallows, 9);
  });

  it("ночная доступность рыбы применяет множитель ×0.6 к плотности, не изменяя саму плотность", () => {
    const fish = new FishField();
    fish.consume("north_bay", 0.3); // density = 0.7
    const nightMultiplier = getWorldConstants().day_night.night_fish_availability_multiplier;

    expect(fish.availability("north_bay", false)).toBeCloseTo(0.7, 9);
    expect(fish.availability("north_bay", true)).toBeCloseTo(0.7 * nightMultiplier, 9);
    // Сама плотность (ресурс) не меняется от чтения доступности.
    expect(fish.getDensity("north_bay")).toBeCloseTo(0.7, 9);
  });

  it("snapshot/restore сохраняет плотность по зонам для персистентности", () => {
    const fish = new FishField();
    fish.consume("north_bay", 0.4);
    fish.consume("south_shallows", 0.1);
    const snap = fish.snapshot();

    const restored = new FishField();
    restored.restore(snap);
    expect(restored.getDensity("north_bay")).toBeCloseTo(0.6, 9);
    expect(restored.getDensity("south_shallows")).toBeCloseTo(0.9, 9);
  });
});
