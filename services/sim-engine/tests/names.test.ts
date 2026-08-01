import { describe, expect, it } from "vitest";
import { NameGenerator } from "../src/sim/names.js";

describe("NameGenerator", () => {
  it("не повторяет имена после seedOccupied (restore)", () => {
    const gen = new NameGenerator();
    const first = gen.nameFor("penguin");
    const second = gen.nameFor("penguin");
    expect(first).not.toBe(second);

    const restored = new NameGenerator();
    restored.seedOccupied([
      { name: first, species: "penguin" },
      { name: second, species: "penguin" },
    ]);
    const next = restored.nameFor("penguin");
    expect(next).not.toBe(first);
    expect(next).not.toBe(second);
  });

  it("пропускает занятые имена с суффиксом цикла", () => {
    const gen = new NameGenerator();
    gen.seedOccupied([{ name: "Пика-2", species: "penguin" }]);
    // Даже если счётчик дойдёт до того же base+cycle — occupied блокирует.
    for (let i = 0; i < 5; i++) {
      expect(gen.nameFor("penguin")).not.toBe("Пика-2");
    }
  });
});
