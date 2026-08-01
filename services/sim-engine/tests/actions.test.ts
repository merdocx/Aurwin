import { describe, expect, it } from "vitest";
import { resolveHunt, resolveSignal, resolveEat, rollHuntNotice } from "../src/sim/actions.js";
import { Rng } from "../src/sim/rng.js";
import { FishField } from "../src/world/fish.js";
import { getSimConstants } from "../src/sim/simConstants.js";
import { makeTestCreature } from "./testCreature.js";

describe("resolveHunt (касание = смерть)", () => {
  it("при контакте всегда caught=true и снижает голод", () => {
    const orca = makeTestCreature({
      species: "orca",
      needs: { hunger: 1, energy: 0.8, social: 0.2, sleep_pressure: 0.1 },
      skills: { foraging: 0, evasion: 0, socializing: 0, hunting: 0.1, parenting: 0 },
    });
    const prey = makeTestCreature({ bornAtTick: 0 });
    const outcome = resolveHunt(orca, prey, { guarded: true, coordinated: false, groupProtected: true }, 100, new Rng(1));
    expect(outcome.caught).toBe(true);
    expect(outcome.successProbability).toBe(1);
    expect(orca.needs.hunger).toBeLessThan(1);
  });

  it("rollHuntNotice выше при высоком evasion и threat", () => {
    const orca = makeTestCreature({ species: "orca" });
    const shy = makeTestCreature({
      id: "shy",
      skills: { foraging: 0, evasion: 0.95, socializing: 0, hunting: 0, parenting: 0 },
    });
    shy.perceivedStates.set(orca.id, { perceivedVigor: 0.5, perceivedThreat: 1, lastSignalTick: 0 });
    const bold = makeTestCreature({
      id: "bold",
      skills: { foraging: 0, evasion: 0, socializing: 0, hunting: 0, parenting: 0 },
    });
    bold.perceivedStates.set(orca.id, { perceivedVigor: 0.5, perceivedThreat: 0.01, lastSignalTick: 0 });

    let shyNoticed = 0;
    let boldNoticed = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      if (rollHuntNotice(orca, shy, 100, new Rng(i + 1))) shyNoticed++;
      if (rollHuntNotice(orca, bold, 100, new Rng(i + 1))) boldNoticed++;
    }
    expect(shyNoticed).toBeGreaterThan(boldNoticed);
  });
});

describe("resolveSignal (7.8.2, 7.8.4)", () => {
  it("display_vigor всегда 'заявляет' claimed_state=1 независимо от истинной бодрости", () => {
    const sender = makeTestCreature({ needs: { hunger: 0.2, energy: 0.1, social: 0.2, sleep_pressure: 0.1 } });
    const receiver = makeTestCreature({ species: "orca" });
    const record = resolveSignal(sender, "display_vigor", "main_ice", 0.1, 1, [receiver], 100, 20, () => "sig-1");
    expect(record.claimedState).toBe(1);
    expect(record.trueState).toBe(0.1);
    expect(record.outcome).toBe("pending");
  });

  it("сигнал сдвигает perceivedVigor получателя пропорционально доверию, доверие создаётся со стартовым значением по умолчанию", () => {
    const sender = makeTestCreature({ id: "sender" });
    const receiver = makeTestCreature({ id: "receiver", species: "orca" });
    receiver.perceivedStates.set("sender", { perceivedVigor: 0.2, perceivedThreat: 0, lastSignalTick: -1 });

    resolveSignal(sender, "display_vigor", "main_ice", 0.9, 1, [receiver], 100, 20, () => "sig-2");

    const trust = receiver.trust.get("sender");
    expect(trust?.trust).toBe(getSimConstants().signaling.trust.starting_value);
    const perceived = receiver.perceivedStates.get("sender");
    expect(perceived!.perceivedVigor).toBeGreaterThan(0.2);
  });

  it("нигде не выставляется флаг 'ложный сигнал' в момент подачи (7.8, критично)", () => {
    const sender = makeTestCreature();
    const record = resolveSignal(sender, "alarm_call", "north_bay", 0, 1, [], 100, 20, () => "sig-3");
    expect(record).not.toHaveProperty("is_deceptive");
    expect(record).not.toHaveProperty("isDeceptive");
    expect(record).not.toHaveProperty("honest");
  });
});

describe("resolveEat", () => {
  it("нет рыбы в зоне -> кормёжка не удаётся", () => {
    const fish = new FishField();
    fish.consume("north_bay", 999);
    const creature = makeTestCreature({ zone: "north_bay" });
    const result = resolveEat(creature, fish, false, 100, new Rng(1));
    expect(result.success).toBe(false);
  });

  it("детёныш кормится сам неэффективно (х0.3, 7.4/7.9)", () => {
    const adult = makeTestCreature({ zone: "north_bay", bornAtTick: -100000000, skills: { foraging: 0.9, evasion: 0, socializing: 0, hunting: 0, parenting: 0 } });
    const juvenile = makeTestCreature({ zone: "north_bay", bornAtTick: 0, skills: { foraging: 0.9, evasion: 0, socializing: 0, hunting: 0, parenting: 0 } });

    let adultSuccesses = 0;
    let juvenileSuccesses = 0;
    const n = 1000;
    for (let i = 0; i < n; i++) {
      if (resolveEat(adult, new FishField(), false, 100, new Rng(i + 1)).success) adultSuccesses++;
      if (resolveEat(juvenile, new FishField(), false, 100, new Rng(i + 1)).success) juvenileSuccesses++;
    }
    expect(juvenileSuccesses).toBeLessThan(adultSuccesses);
  });
});
