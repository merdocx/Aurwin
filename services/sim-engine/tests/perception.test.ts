import { describe, expect, it } from "vitest";
import { hearingRange, visionRange } from "../src/sim/perception.js";
import { getSimConstants } from "../src/sim/simConstants.js";
import { makeTestCreature } from "./testCreature.js";

describe("visionRange / hearingRange (диск зрения vs слух)", () => {
  it("у спящего зрение урезано, слух остаётся полным (hearing ≠ vision)", () => {
    const asleep = makeTestCreature({ species: "penguin", isAsleep: true });
    const dn = getSimConstants().day_night;

    const vision = visionRange(asleep, "day");
    const hearing = hearingRange(asleep);

    expect(vision).toBeCloseTo(
      dn.perception_radius.penguin.day * dn.asleep_perception_multiplier.penguin,
      9,
    );
    expect(hearing).toBe(dn.hearing_radius.penguin);
    expect(vision).toBeLessThan(hearing);
  });

  it("бодрствующий днём: visionRange совпадает с perception_radius.day", () => {
    const awake = makeTestCreature({ species: "orca", isAsleep: false });
    const dn = getSimConstants().day_night;
    expect(visionRange(awake, "day")).toBe(dn.perception_radius.orca.day);
    expect(visionRange(awake, "night")).toBe(dn.perception_radius.orca.night);
    expect(hearingRange(awake)).toBe(dn.hearing_radius.orca);
  });
});
