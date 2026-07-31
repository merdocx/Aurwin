import { getSimConstants } from "./simConstants.js";
import { transmissionWeight } from "./authority.js";
import type { Creature, Episode, EpisodeType } from "./types.js";
import type { ZoneName } from "../world/zones.js";

export interface NewEpisodeInput {
  type: EpisodeType;
  participants: string[];
  significance: number;
  learnedFrom?: string;
  transmissionDepth?: number;
  zone?: ZoneName;
}

/** Создаёт эпизод, помечает core_memory по порогу (А.2) и запускает прунинг. */
export function recordEpisode(creature: Creature, tick: number, input: NewEpisodeInput, idFactory: () => string): Episode {
  const constants = getSimConstants();
  const episode: Episode = {
    id: idFactory(),
    creatureId: creature.id,
    tick,
    type: input.type,
    participants: input.participants,
    significance: input.significance,
    consumedByReflection: false,
    learnedFrom: input.learnedFrom,
    transmissionDepth: input.transmissionDepth ?? 0,
    coreMemory: input.significance >= constants.memory.core_memory_significance_threshold,
    zone: input.zone,
  };
  creature.episodes.push(episode);
  pruneEpisodes(creature);
  return episode;
}

/**
 * Прунинг (А.2): удаляются сначала `consumed_by_reflection` с наименьшей
 * significance, `core_memory` не удаляется никогда. Лимит — species-specific
 * (`memory.episodic_limit`).
 */
export function pruneEpisodes(creature: Creature): void {
  const limit = getSimConstants().memory.episodic_limit[creature.species];
  const over = creature.episodes.length - limit;
  if (over <= 0) return;

  const removable = creature.episodes
    .map((e, idx) => ({ e, idx }))
    .filter(({ e }) => !e.coreMemory)
    .sort((a, b) => {
      if (a.e.consumedByReflection !== b.e.consumedByReflection) return a.e.consumedByReflection ? -1 : 1;
      return a.e.significance - b.e.significance;
    });

  const removeIdx = new Set<number>();
  let toRemove = over;
  for (const { idx } of removable) {
    if (toRemove <= 0) break;
    removeIdx.add(idx);
    toRemove--;
  }
  if (removeIdx.size > 0) {
    creature.episodes = creature.episodes.filter((_, idx) => !removeIdx.has(idx));
  }
}

/** Затухание значимости памяти за реальное время (А.2: пингвин ×0.90/сут, касатка ×0.97/сут). core_memory не затухает. */
export function decayEpisodeSignificance(creature: Creature, dtRealSeconds: number): void {
  const decayPerDay = getSimConstants().memory.significance_decay_per_day[creature.species];
  const dtDays = dtRealSeconds / 86400;
  const factor = Math.pow(decayPerDay, dtDays);
  for (const episode of creature.episodes) {
    if (episode.coreMemory) continue;
    episode.significance *= factor;
  }
}

/**
 * Социальное обучение (7.7, механизм 3), взвешенное авторитетностью
 * источника (механизм 5): значимый ЛИЧНЫЙ эпизод источника порождает
 * ослабленные эпизоды у свидетелей (×0.4) и связанных друзей (×0.25).
 * transmission_depth = depth(source) + 1.
 *
 * Упрощение относительно буквального текста 7.7: друзьям по связи эпизод
 * доставляется НЕМЕДЛЕННО, а не "с задержкой до следующей встречи" — иначе
 * потребовалась бы отдельная очередь отложенной доставки с риском, что
 * эпизод так и не найдёт адресата, если источник умрёт раньше встречи.
 * Наблюдаемый эффект (друг узнаёт об опасности зоны, ни разу там не
 * побывав) сохраняется полностью; теряется только точный тайминг
 * доставки. См. ops/DEVIATIONS.md, фаза 4.
 */
export function propagateSocialLearning(
  source: Creature,
  sourceEpisode: Episode,
  witnesses: Creature[],
  bondedFriends: Creature[],
  currentTick: number,
  idFactory: () => string,
): Episode[] {
  const constants = getSimConstants();
  const weight = transmissionWeight(source.authority);
  const depth = sourceEpisode.transmissionDepth + 1;
  const created: Episode[] = [];

  const alreadyReached = new Set<string>();

  const deliver = (recipient: Creature, multiplier: number) => {
    if (recipient.id === source.id) return;
    if (sourceEpisode.participants.includes(recipient.id)) return;
    if (alreadyReached.has(recipient.id)) return;
    alreadyReached.add(recipient.id);
    created.push(
      recordEpisode(
        recipient,
        currentTick,
        {
          type: sourceEpisode.type,
          participants: sourceEpisode.participants,
          significance: sourceEpisode.significance * multiplier * weight,
          learnedFrom: source.id,
          transmissionDepth: depth,
          zone: sourceEpisode.zone,
        },
        idFactory,
      ),
    );
  };

  for (const witness of witnesses) deliver(witness, constants.skills.social_learning.witness_multiplier);
  for (const friend of bondedFriends) deliver(friend, constants.skills.social_learning.bonded_friend_multiplier);

  return created;
}

/**
 * Вертикальная передача при формировании связи (7.7, механизм 5): более
 * авторитетная сторона делится своим самым значимым эпизодом с менее
 * авторитетной, если у той ещё нет знания о том же типе/зоне. Это то,
 * благодаря чему знание переживает своего первоначального носителя —
 * повторные "переприкрепления" дают transmission_depth 2+ по мере смены
 * поколений.
 */
export function transmitOnBondFormed(a: Creature, b: Creature, currentTick: number, idFactory: () => string): Episode | undefined {
  const [elder, junior] = a.authority >= b.authority ? [a, b] : [b, a];
  if (elder.episodes.length === 0 || elder.authority <= junior.authority) return undefined;

  const best = [...elder.episodes].sort((x, y) => y.significance - x.significance)[0];
  const juniorAlreadyKnows = junior.episodes.some((e) => e.type === best.type && e.zone === best.zone);
  if (juniorAlreadyKnows) return undefined;

  const weight = transmissionWeight(elder.authority);
  const multiplier = getSimConstants().skills.social_learning.bonded_friend_multiplier;
  return recordEpisode(
    junior,
    currentTick,
    {
      type: best.type,
      participants: best.participants,
      significance: best.significance * multiplier * weight,
      learnedFrom: elder.id,
      transmissionDepth: best.transmissionDepth + 1,
      zone: best.zone,
    },
    idFactory,
  );
}
