import { afterEach, describe, expect, it } from "vitest";
import { seedGenesisNarratives, type GenesisNarrativeTransport } from "../src/sim/genesisNarrative.js";
import { makeTestCreature } from "./testCreature.js";

class FakeGenesisTransport implements GenesisNarrativeTransport {
  constructor(private readonly text: string) {}

  async createMessage(): Promise<{ text: string }> {
    return { text: this.text };
  }
}

describe("genesisNarrative", () => {
  const oldKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = oldKey;
  });

  it("применяет narrative, facts и intentions из одного LLM-ответа к genesis-особям", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const a = makeTestCreature({ id: "g1", name: "Грета", intentions: [], narrativeFacts: ["fallback"] });
    const b = makeTestCreature({ id: "g2", name: "Олаф", species: "orca", intentions: [], narrativeFacts: ["fallback"] });
    const transport = new FakeGenesisTransport(
      JSON.stringify({
        creatures: [
          {
            id: "g1",
            narrative: "Я только начинаю узнавать мир и тянусь к спокойным местам.",
            narrative_facts: ["Молодая и осторожная", "Любит спокойствие"],
            intentions: [{ text: "держаться ближе к льду", effect: { prefer_zone: "main_ice" } }],
          },
          {
            id: "g2",
            narrative: "Я силен и внимателен к воде вокруг.",
            narrative_facts: ["Молодой самец касатки"],
            intentions: [{ text: "осматриваться в воде", effect: { prefer_zone: "open_water" } }],
          },
        ],
      }),
    );

    await seedGenesisNarratives([a, b], transport);

    expect(a.narrative).toContain("начинаю узнавать мир");
    expect(a.narrativeFacts).toEqual(["Молодая и осторожная", "Любит спокойствие"]);
    expect(a.intentions[0]?.effect.prefer_zone).toBe("main_ice");
    expect(b.narrativeFacts).toEqual(["Молодой самец касатки"]);
    expect(b.intentions[0]?.effect.prefer_zone).toBe("open_water");
  });

  it("при невалидном ответе оставляет fallback без падения запуска", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const creature = makeTestCreature({ id: "g3", narrativeFacts: ["fallback"], intentions: [] });

    await seedGenesisNarratives([creature], new FakeGenesisTransport("{bad json"));

    expect(creature.narrative).toBeUndefined();
    expect(creature.narrativeFacts).toEqual(["fallback"]);
    expect(creature.intentions).toEqual([]);
  });
});
