import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createReplayReflectionGenerator, loadReplayReflectionLibrary } from "../src/cli/replayReflections.js";
import { makeTestCreature } from "./testCreature.js";

describe("replayReflections", () => {
  it("загружает samples из JSON и нормализует snake_case поля", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aurwin-replay-"));
    const file = path.join(dir, "samples.json");
    writeFileSync(
      file,
      JSON.stringify([
        {
          species: "penguin",
          narrative: "Я запомнил опасную воду.",
          narrative_facts: ["Опасается воды"],
          trait_deltas: { caution: 0.1 },
          weight_deltas: { "w_need.hunger": 0.05 },
          intentions: [{ text: "избегать воды", effect: { avoid_zone: "open_water" } }],
        },
      ]),
    );

    const samples = loadReplayReflectionLibrary(file);
    expect(samples).toHaveLength(1);
    expect(samples[0]?.narrativeFacts).toEqual(["Опасается воды"]);
    expect(samples[0]?.traitDeltas?.caution).toBe(0.1);
    expect(samples[0]?.weightDeltas?.["w_need.hunger"]).toBe(0.05);
  });

  it("генератор подмешивает species-совместимые recorded reflections", () => {
    const generator = createReplayReflectionGenerator([
      {
        species: "penguin",
        narrative: "Я осторожен.",
        narrativeFacts: ["Осторожный"],
        traitDeltas: { caution: 0.1 },
        intentions: [{ text: "держаться льда", effect: { prefer_zone: "main_ice" } }],
      },
      {
        species: "orca",
        narrative: "Я ищу добычу.",
        narrativeFacts: ["Голоден"],
        weightDeltas: { "w_need.hunger": 0.05 },
        intentions: [{ text: "осматривать воду", effect: { prefer_zone: "open_water" } }],
      },
    ]);

    const penguin = makeTestCreature({ species: "penguin", narrativeFacts: ["fallback"] });
    const orca = makeTestCreature({ species: "orca", narrativeFacts: ["fallback"] });

    const penguinReflection = generator(penguin);
    const orcaReflection = generator(orca);

    expect(penguinReflection.narrative).toContain("осторож");
    expect(penguinReflection.traitDeltas.caution).toBe(0.1);
    expect(penguinReflection.intentions[0]?.effect.prefer_zone).toBe("main_ice");
    expect(orcaReflection.weightDeltas["w_need.hunger"]).toBe(0.05);
    expect(orcaReflection.intentions[0]?.effect.prefer_zone).toBe("open_water");
  });
});
