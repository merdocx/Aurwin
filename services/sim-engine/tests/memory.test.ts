import { describe, expect, it } from "vitest";
import { decayEpisodeSignificance, propagateSocialLearning, pruneEpisodes, recordEpisode, transmitOnBondFormed } from "../src/sim/memory.js";
import { getSimConstants } from "../src/sim/simConstants.js";
import { makeTestCreature } from "./testCreature.js";

let idCounter = 0;
const nextId = () => `ep-${idCounter++}`;

describe("memory: recordEpisode / pruneEpisodes", () => {
  it("эпизод со significance >= порога помечается core_memory (А.2)", () => {
    const creature = makeTestCreature();
    const threshold = getSimConstants().memory.core_memory_significance_threshold;
    const episode = recordEpisode(creature, 10, { type: "friend_died", participants: [], significance: threshold + 0.01 }, nextId);
    expect(episode.coreMemory).toBe(true);
  });

  it("прунинг удаляет сначала consumed_by_reflection с наименьшей significance, не трогая core_memory", () => {
    const creature = makeTestCreature({ species: "penguin" });
    const limit = getSimConstants().memory.episodic_limit.penguin;
    for (let i = 0; i < limit + 5; i++) {
      const ep = recordEpisode(creature, i, { type: "bond_formed", participants: [], significance: 0.1 }, nextId);
      ep.consumedByReflection = true;
    }
    const core = recordEpisode(creature, 999, { type: "friend_died", participants: [], significance: 0.95 }, nextId);
    expect(creature.episodes.length).toBeLessThanOrEqual(limit);
    expect(creature.episodes.some((e) => e.id === core.id)).toBe(true);
  });
});

describe("memory: decayEpisodeSignificance", () => {
  it("significance затухает за реальные сутки, core_memory не затухает", () => {
    const creature = makeTestCreature({ species: "penguin" });
    const normal = recordEpisode(creature, 0, { type: "hunt_success", participants: [], significance: 0.5 }, nextId);
    const core = recordEpisode(creature, 0, { type: "friend_died", participants: [], significance: 0.95 }, nextId);
    decayEpisodeSignificance(creature, 86400);
    expect(normal.significance).toBeLessThan(0.5);
    expect(core.significance).toBe(0.95);
  });
});

describe("memory: propagateSocialLearning (7.7, механизмы 3 и 5)", () => {
  it("свидетели и друзья получают ослабленный эпизод с transmission_depth = depth(source)+1", () => {
    const source = makeTestCreature({ id: "source", authority: 0.5 });
    const witness = makeTestCreature({ id: "witness" });
    const friend = makeTestCreature({ id: "friend" });

    const sourceEpisode = recordEpisode(source, 100, { type: "friend_died", participants: ["dead"], significance: 0.9, zone: "north_bay" }, nextId);
    propagateSocialLearning(source, sourceEpisode, [witness], [friend], 100, nextId);

    expect(witness.episodes).toHaveLength(1);
    expect(witness.episodes[0].transmissionDepth).toBe(1);
    expect(witness.episodes[0].learnedFrom).toBe("source");
    expect(witness.episodes[0].significance).toBeLessThan(sourceEpisode.significance);

    expect(friend.episodes).toHaveLength(1);
    expect(friend.episodes[0].significance).toBeLessThan(witness.episodes[0].significance); // 0.25 < 0.4 multiplier
  });

  it("более высокая авторитетность источника даёт более сильный отпечаток (механизм 5)", () => {
    const lowAuthoritySource = makeTestCreature({ id: "low", authority: 0.1 });
    const highAuthoritySource = makeTestCreature({ id: "high", authority: 0.9 });
    const w1 = makeTestCreature({ id: "w1" });
    const w2 = makeTestCreature({ id: "w2" });

    const ep1 = recordEpisode(lowAuthoritySource, 0, { type: "friend_died", participants: [], significance: 0.9 }, nextId);
    const ep2 = recordEpisode(highAuthoritySource, 0, { type: "friend_died", participants: [], significance: 0.9 }, nextId);

    propagateSocialLearning(lowAuthoritySource, ep1, [w1], [], 0, nextId);
    propagateSocialLearning(highAuthoritySource, ep2, [w2], [], 0, nextId);

    expect(w2.episodes[0].significance).toBeGreaterThan(w1.episodes[0].significance);
  });
});

describe("memory: transmitOnBondFormed (традиции переживают носителя, 7.7 механизм 5)", () => {
  it("более авторитетная сторона передаёт своё главное знание менее авторитетной при образовании связи", () => {
    const elder = makeTestCreature({ id: "elder", authority: 0.8 });
    const junior = makeTestCreature({ id: "junior", authority: 0.1 });
    recordEpisode(elder, 0, { type: "friend_died", participants: [], significance: 0.9, zone: "north_bay" }, nextId);

    const created = transmitOnBondFormed(elder, junior, 500, nextId);
    expect(created).toBeDefined();
    expect(junior.episodes).toHaveLength(1);
    expect(junior.episodes[0].zone).toBe("north_bay");
    expect(junior.episodes[0].transmissionDepth).toBe(1);
  });

  it("повторная передача через второе поколение даёт transmission_depth >= 2 (предание переживает очевидцев)", () => {
    const original = makeTestCreature({ id: "original", authority: 0.8 });
    recordEpisode(original, 0, { type: "friend_died", participants: [], significance: 0.9, zone: "north_bay" }, nextId);

    const middleGen = makeTestCreature({ id: "middle", authority: 0.2 });
    transmitOnBondFormed(original, middleGen, 100, nextId);
    expect(middleGen.episodes[0].transmissionDepth).toBe(1);

    // middleGen становится авторитетнее нового поколения и передаёт дальше.
    middleGen.authority = 0.8;
    const newGen = makeTestCreature({ id: "newgen", authority: 0.1 });
    transmitOnBondFormed(middleGen, newGen, 2000, nextId);

    expect(newGen.episodes).toHaveLength(1);
    expect(newGen.episodes[0].transmissionDepth).toBeGreaterThanOrEqual(2);
  });
});
