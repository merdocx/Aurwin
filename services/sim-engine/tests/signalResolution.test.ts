import { describe, expect, it } from "vitest";
import { applyTrustUpdate, resolveAlarmCallsOnExpiry, resolveDisplayVigorAgainstHunt, wakeSleepersOnAlarm } from "../src/sim/signalResolution.js";
import { resolveSignal } from "../src/sim/actions.js";
import { Rng } from "../src/sim/rng.js";
import { getSimConstants } from "../src/sim/simConstants.js";
import { makeTestCreature } from "./testCreature.js";

describe("signalResolution: доверие (7.8.4, асимметрия)", () => {
  it("подтверждение растёт медленнее, чем падает опровержение", () => {
    const receiver = makeTestCreature();
    applyTrustUpdate(receiver, "sender", true);
    const gained = receiver.trust.get("sender")!.trust - getSimConstants().signaling.trust.starting_value;

    const receiver2 = makeTestCreature();
    applyTrustUpdate(receiver2, "sender", false);
    const lost = getSimConstants().signaling.trust.starting_value - receiver2.trust.get("sender")!.trust;

    expect(lost).toBeGreaterThan(gained);
  });

  it("'мальчик, который кричал волк': повторные опровержения обнуляют доверие", () => {
    const receiver = makeTestCreature();
    for (let i = 0; i < 10; i++) applyTrustUpdate(receiver, "liar", false);
    expect(receiver.trust.get("liar")!.trust).toBe(0);
  });
});

describe("signalResolution: display_vigor разрешается по исходу охоты (7.8.3)", () => {
  it("лёгкая поимка без предупреждения опровергает демонстрацию силы и снижает доверие атаковавшей касатки", () => {
    const prey = makeTestCreature({ id: "prey" });
    const orca = makeTestCreature({ id: "orca", species: "orca" });
    const signal = resolveSignal(prey, "display_vigor", "main_ice", 0.2, 1, [orca], 100, 20, () => "s1");

    const resolved = resolveDisplayVigorAgainstHunt(prey, orca, [signal], true, false);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].outcome).toBe("disconfirmed");
    expect(orca.trust.get("prey")!.trust).toBeLessThan(getSimConstants().signaling.trust.starting_value);
  });

  it("жертва не поймана -> демонстрация силы подтверждена", () => {
    const prey = makeTestCreature({ id: "prey" });
    const orca = makeTestCreature({ id: "orca", species: "orca" });
    const signal = resolveSignal(prey, "display_vigor", "main_ice", 0.9, 1, [orca], 100, 20, () => "s2");

    const resolved = resolveDisplayVigorAgainstHunt(prey, orca, [signal], false, false);
    expect(resolved[0].outcome).toBe("confirmed");
    expect(orca.trust.get("prey")!.trust).toBeGreaterThan(getSimConstants().signaling.trust.starting_value);
  });
});

describe("signalResolution: alarm_call разрешается по истечении окна", () => {
  it("отсутствие реальной охоты в зоне за окно -> disconfirmed", () => {
    const sender = makeTestCreature({ id: "crier" });
    const receiver = makeTestCreature({ id: "listener" });
    const signal = resolveSignal(sender, "alarm_call", "north_bay", 0, 1, [receiver], 100, 20, () => "s3");

    const resolved = resolveAlarmCallsOnExpiry([signal], 130, new Map([["listener", receiver]]), () => false);
    expect(resolved[0].outcome).toBe("disconfirmed");
    expect(receiver.trust.get("crier")!.trust).toBeLessThan(getSimConstants().signaling.trust.starting_value);
  });

  it("реальная охота в зоне за окно -> confirmed", () => {
    const sender = makeTestCreature({ id: "crier" });
    const receiver = makeTestCreature({ id: "listener" });
    const signal = resolveSignal(sender, "alarm_call", "north_bay", 0, 1, [receiver], 100, 20, () => "s4");

    const resolved = resolveAlarmCallsOnExpiry([signal], 130, new Map([["listener", receiver]]), () => true);
    expect(resolved[0].outcome).toBe("confirmed");
  });
});

describe("signalResolution: пробуждение по тревоге (7.10)", () => {
  it("будит спящих; сила эффекта зависит от доверия к кричавшему", () => {
    const sender = makeTestCreature({ id: "crier" });
    const trustedSleeper = makeTestCreature({ id: "trusted", isAsleep: true });
    trustedSleeper.trust.set("crier", { trust: 1, confirmations: 5, disconfirmations: 0 });
    const distrustedSleeper = makeTestCreature({ id: "distrusted", isAsleep: true });
    distrustedSleeper.trust.set("crier", { trust: 0, confirmations: 0, disconfirmations: 5 });

    const woken = wakeSleepersOnAlarm(sender, [trustedSleeper, distrustedSleeper], new Rng(1));
    expect(woken.map((c) => c.id)).toContain("trusted");
    expect(woken.map((c) => c.id)).not.toContain("distrusted");
    expect(trustedSleeper.isAsleep).toBe(false);
    expect(distrustedSleeper.isAsleep).toBe(true);
  });
});
