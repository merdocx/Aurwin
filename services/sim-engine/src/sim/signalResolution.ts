import type { Rng } from "./rng.js";
import { applyEmotionDelta, EMOTION_DELTAS } from "./emotion.js";
import { getSimConstants } from "./simConstants.js";
import type { Creature, SignalRecord } from "./types.js";

/**
 * Обновление кредита доверия (7.8.4): подтверждение растёт медленно,
 * опровержение падает заметно быстрее (асимметрия "мальчик, который
 * кричал волк"). Запись создаётся с дефолтным стартовым значением при
 * первом обращении получателя к этому отправителю.
 */
export function applyTrustUpdate(receiver: Creature, senderId: string, confirmed: boolean): void {
  const constants = getSimConstants().signaling.trust;
  const entry = receiver.trust.get(senderId) ?? { trust: constants.starting_value, confirmations: 0, disconfirmations: 0 };
  if (confirmed) {
    entry.trust = Math.min(1, entry.trust + constants.gain_on_confirmation);
    entry.confirmations += 1;
  } else {
    entry.trust = Math.max(0, entry.trust - constants.loss_on_refutation);
    entry.disconfirmations += 1;
  }
  receiver.trust.set(senderId, entry);
}

/**
 * display_vigor разрешается по факту исхода охоты (7.8.3: "После попытки
 * касатка узнаёт правду — по фактической сложности преследования"). Только
 * АТАКОВАВШАЯ касатка получает прямое подтверждение/опровержение — прочие
 * получатели сигнала ничего не наблюдали лично.
 */
export function resolveDisplayVigorAgainstHunt(
  prey: Creature,
  orca: Creature,
  pendingSignalsBySender: SignalRecord[],
  caught: boolean,
  noticedInAdvance: boolean,
): SignalRecord[] {
  const resolved: SignalRecord[] = [];
  for (const sig of pendingSignalsBySender) {
    if (sig.senderId !== prey.id || sig.type !== "display_vigor" || sig.outcome !== "pending") continue;
    if (!sig.receivers.includes(orca.id)) continue;
    // Трудно поймать или жертва заметила заранее => демонстрация силы подтвердилась.
    const confirmed = !caught || noticedInAdvance;
    sig.outcome = confirmed ? "confirmed" : "disconfirmed";
    applyTrustUpdate(orca, prey.id, confirmed);
    resolved.push(sig);
  }
  return resolved;
}

/**
 * alarm_call разрешается по истечении окна (А.3, шаг 7: "истёк срок...").
 * Подтверждена, если в заявленной зоне за окно (от подачи до resolveByTick)
 * реально произошла попытка охоты — независимое доказательство того, что
 * угроза была настоящей.
 */
export function resolveAlarmCallsOnExpiry(
  pending: SignalRecord[],
  currentTick: number,
  receiversById: Map<string, Creature>,
  predationOccurredInZoneSince: (zone: string, sinceTick: number) => boolean,
): SignalRecord[] {
  const resolved: SignalRecord[] = [];
  for (const sig of pending) {
    if (sig.type !== "alarm_call" || sig.outcome !== "pending") continue;
    if (currentTick < sig.resolveByTick) continue;
    const confirmed = sig.zone !== null && predationOccurredInZoneSince(sig.zone, sig.tick);
    sig.outcome = confirmed ? "confirmed" : "disconfirmed";
    for (const receiverId of sig.receivers) {
      const receiver = receiversById.get(receiverId);
      if (receiver) applyTrustUpdate(receiver, sig.senderId, confirmed);
    }
    resolved.push(sig);
  }
  return resolved;
}

/**
 * Пробуждение по тревоге (7.10): сила эффекта взвешена доверием к
 * кричавшему — ложные тревоги от недоверенных особей не будят сородичей
 * так же надёжно, как от доверенных.
 */
export function wakeSleepersOnAlarm(sender: Creature, receivers: Creature[], rng: Rng): Creature[] {
  const constants = getSimConstants().signaling.trust;
  const woken: Creature[] = [];
  for (const receiver of receivers) {
    if (!receiver.isAsleep) continue;
    const trust = receiver.trust.get(sender.id)?.trust ?? constants.starting_value;
    if (rng.bool(trust)) {
      receiver.isAsleep = false;
      applyEmotionDelta(receiver, EMOTION_DELTAS.woken_by_alarm);
      woken.push(receiver);
    }
  }
  return woken;
}
