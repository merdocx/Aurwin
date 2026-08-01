import { randomUUID } from "node:crypto";
import { Rng, clamp } from "./rng.js";
import { getSimConstants } from "./simConstants.js";
import { NameGenerator } from "./names.js";
import { World } from "../world/world.js";
import type { FishDensitySnapshot } from "../world/fish.js";
import { SpatialGrid, type IndexedPoint } from "../world/spatialIndex.js";
import type { ZoneName } from "../world/zones.js";
import { createGenesisPopulation } from "./genesis.js";
import { processReintroduction } from "./reintroduction.js";
import { canMate, createOffspring, isForbiddenPair } from "./reproduction.js";
import { ageStageFor, ageWeeksAt } from "./lifecycle.js";
import { advanceBioClocks, rollOldAgeDeath } from "./needs.js";
import { sense, decayPerceivedStates, reinforceVisiblePredatorThreat, bumpPreyThreatOfOrca, visionRange, hearingRange } from "./perception.js";
import { decide, type DecideContext, type Decision } from "./utilityAI.js";
import {
  deriveActivity,
  movementTargetPos,
  resolveEat,
  resolveHunt,
  resolveMovement,
  resolveProvision,
  resolveSignal,
  resolveSleepToggle,
  resolveStealthApproach,
  rollHuntNotice,
} from "./actions.js";
import { applyPreContactDefense, applySoftSeparation } from "./separation.js";
import { decayAversions, decayUntouchedBonds, growBondForPair, recordAversion, bondStrengthLookup, aversionStrengthLookup } from "./social.js";
import { decaySkills, growSkill, updateHabit } from "./skillsHabits.js";
import { computeAuthority, transmissionWeight } from "./authority.js";
import { trueVigor } from "./vigor.js";
import { distance } from "./huntingAttractiveness.js";
import { recordEpisode, decayEpisodeSignificance, propagateSocialLearning, transmitOnBondFormed } from "./memory.js";
import { applyTraitDeltas, applyWeightDeltas, generateMockReflection, shouldTriggerBackgroundReflection, type ReflectionResult } from "./reflection.js";
import { applyEmotionDelta, EMOTION_DELTAS } from "./emotion.js";
import { applyTrustUpdate, resolveAlarmCallsOnExpiry, resolveDisplayVigorAgainstHunt, wakeSleepersOnAlarm } from "./signalResolution.js";
import { ticksToRealSeconds, realHoursToTicks } from "./time.js";
import {
  aversionKey,
  bondKey,
  isAlive,
  type AversionRecord,
  type BondRecord,
  type Creature,
  type DecisionLogEntry,
  type Episode,
  type Sex,
  type SignalRecord,
  type Species,
  type WorldEvent,
} from "./types.js";

const SIGNAL_RESOLVE_WINDOW_TICKS_FN = () => Math.round(realHoursToTicks(1));
const WITNESS_QUERY_CELL_SIZE = 50;

interface PendingReflection {
  creatureId: string;
  result: ReflectionResult;
}

export interface SimulationHooks {
  onWorldEvent?: (event: WorldEvent) => void;
  /**
   * По умолчанию true — заглушка `generateMockReflection` (sim/reflection.ts)
   * управляет намерениями/narrative в отсутствие реального LLM (нужно
   * `npm run simulate --fast`, см. cli/simulate.ts, для offline-прогонов
   * баланса без БД/API-ключа). Живой продакшн-процесс (index.ts, фаза 6)
   * передаёт false: реальный reflection-worker теперь САМ пишет эти поля
   * прямо в Postgres (apply.ts), и если оставить заглушку включённой, её
   * тиковый (не привязанный к реальному времени процесса reflection-worker)
   * пересчёт периодически затирал бы в памяти intentions/narrative,
   * применённые reflection-worker — единственный писатель этих полей в
   * рамках одного запущенного процесса должен быть один (см.
   * ops/DEVIATIONS.md, фаза 6).
   */
  mockReflectionEnabled?: boolean;
}

/**
 * Восстановленное после рестарта состояние мира (А.7: снапшот не реже раза
 * в минуту, восстановление при рестарте, "время после паузы НЕ догоняется").
 * Построено persistence/restore.ts из world_clock/creatures/bonds/aversions.
 * Episodes/perceivedStates/trust/actionCounts не персистентны (см.
 * ops/DEVIATIONS.md, фаза 7) — сознательный пробел, не растягиваемый на
 * потерю ≤ 1 минуты жизни мира.
 */
export interface RestoredWorldState {
  tick: number;
  creatures: Creature[];
  bonds: BondRecord[];
  aversions: AversionRecord[];
  fishDensity?: FishDensitySnapshot;
}

/** Метрики, накапливаемые по ходу симуляции — потребляются CLI-отчётом (task 12/13). */
export interface SimAccumulators {
  births: Record<Species, number>;
  deaths: Record<Species, Record<string, number>>;
  signalsSent: Record<string, number>;
  signalsDisconfirmed: Record<string, number>;
  guardEpisodes: number;
  provisionEpisodes: number;
  coordinatedHunts: number;
  transmissionDepth2Plus: number;
  totalEpisodesCreated: number;
}

function freshAccumulators(): SimAccumulators {
  return {
    births: { penguin: 0, orca: 0 },
    deaths: { penguin: {}, orca: {} },
    signalsSent: {},
    signalsDisconfirmed: {},
    guardEpisodes: 0,
    provisionEpisodes: 0,
    coordinatedHunts: 0,
    transmissionDepth2Plus: 0,
    totalEpisodesCreated: 0,
  };
}

/**
 * Оркестратор тик-пайплайна (А.3, все 14 шагов). Персистентность в
 * Postgres (шаг 14 — persistSnapshot) и передача дельт наблюдателям (шаг 13
 * — broadcastDelta) — именованные хуки без реализации в фазе 4: это задачи
 * фазы 5 (api-gateway) и последующей интеграции с БД (см. ops/DEVIATIONS.md,
 * «фаза 4», обоснование — `--fast` прогон обязан оставаться чисто
 * in-memory, иначе 30-суточный прогон стал бы неприемлемо медленным).
 */
export class Simulation {
  readonly world: World;
  readonly rng: Rng;
  readonly creatures = new Map<string, Creature>();
  readonly bonds = new Map<string, BondRecord>();
  readonly aversions = new Map<string, AversionRecord>();
  readonly acc: SimAccumulators = freshAccumulators();
  readonly decisionLog: DecisionLogEntry[] = [];
  readonly recentWorldEvents: WorldEvent[] = [];

  private tick_ = 0;
  private nameGen = new NameGenerator();
  private spatialIndex = new SpatialGrid<IndexedPoint>(WITNESS_QUERY_CELL_SIZE);
  private pendingReflections: PendingReflection[] = [];
  private pendingSignals: SignalRecord[] = [];
  /**
   * Эпизоды, созданные с последнего drainNewEpisodes() (фаза 6): index.ts
   * персистит их в таблицу `episodes` тем же приёмом, что и pendingEvents/
   * pendingDeaths (буфер очищается при каждом успешном флаше). Это закрывает
   * пробел, обнаруженный при реализации reflection-worker — без записи
   * `episodes` в Postgres событийная рефлексия не могла бы найти свои
   * триггеры ни в одном реально работающем процессе (см. ops/DEVIATIONS.md,
   * фаза 6). `zone` эпизода намеренно НЕ идёт в БД — А.2 не содержит эту
   * колонку в схеме `episodes` (zone — внутреннее расширение sim-engine для
   * memory.ts, дублирующая информация уже есть в habits существа).
   */
  private episodesThisTick: Episode[] = [];
  /**
   * Сигналы, созданные с последнего drain (INSERT в `signals`). Outcome на
   * момент создания может быть уже финальным (stealth_approach всегда
   * disconfirmed сразу, 7.8.2) или pending — тогда UPDATE придёт через
   * `signalsResolvedThisTick` после разрешения.
   */
  private signalsCreatedThisTick: SignalRecord[] = [];
  /** Сигналы, у которых outcome сменился с pending на confirmed/disconfirmed. */
  private signalsResolvedThisTick: SignalRecord[] = [];
  /** Сэмплированные utility-решения с последнего drain (INSERT в `decision_log`). */
  private decisionLogsThisTick: DecisionLogEntry[] = [];
  private recentPredation: Array<{ zone: ZoneName; tick: number }> = [];
  private observedCohort = new Set<string>();
  private eventWindowUntil = new Map<string, number>();
  private hooks: SimulationHooks;
  private readonly decisionLogCap = 20_000;
  private readonly worldEventsCap = 5_000;
  /** Последняя реинтродукция по виду — кулдаун между повторными подселениями (7.4). */
  private lastReintroductionTick: Partial<Record<Species, number>> = {};

  constructor(seed: number, hooks: SimulationHooks = {}, restore?: RestoredWorldState) {
    this.rng = new Rng(seed);
    this.world = new World();
    this.hooks = hooks;
    if (restore) {
      this.tick_ = restore.tick;
      this.world.fastForwardTo(restore.tick);
      this.world.restoreFishDensity(restore.fishDensity);
      for (const creature of restore.creatures) this.creatures.set(creature.id, creature);
      for (const bond of restore.bonds) this.bonds.set(bondKey(bond.creatureA, bond.creatureB), bond);
      for (const aversion of restore.aversions) this.aversions.set(aversionKey(aversion.subjectId, aversion.objectId), aversion);
    } else {
      const population = createGenesisPopulation(0, this.rng, this.nameGen, this.nextId);
      for (const creature of population) this.creatures.set(creature.id, creature);
    }
    this.rotateObservedCohort();
  }

  /**
   * Реальный UUID (не последовательный "c0","c1"...): id существа —
   * одновременно первичный ключ `creatures.id UUID` в Postgres (фаза 5,
   * персистентность). `bonds`/`aversions` полагаются на лексикографический
   * "UUID-порядок" (см. комментарий в migrations/003_bonds.cjs) для
   * канонической пары creature_a < creature_b — сравнение строк работает
   * одинаково что для последовательных, что для случайных id, инвариант не
   * страдает.
   */
  private nextId = (): string => randomUUID();

  get currentTick(): number {
    return this.tick_;
  }

  aliveCreatures(): Creature[] {
    return [...this.creatures.values()].filter(isAlive);
  }

  /** Забирает и очищает буфер новых эпизодов (фаза 6, index.ts::persistTick). */
  drainNewEpisodes(): Episode[] {
    const batch = this.episodesThisTick;
    this.episodesThisTick = [];
    return batch;
  }

  /** Новые сигналы для INSERT в Postgres (А.2 `signals`). */
  drainNewSignals(): SignalRecord[] {
    const batch = this.signalsCreatedThisTick;
    this.signalsCreatedThisTick = [];
    return batch;
  }

  /** Сигналы с обновлённым outcome для UPDATE в Postgres. */
  drainResolvedSignals(): SignalRecord[] {
    const batch = this.signalsResolvedThisTick;
    this.signalsResolvedThisTick = [];
    return batch;
  }

  /** Сэмплированные решения для INSERT в `decision_log` (А.2, семплинг А.2/А.9). */
  drainDecisionLogs(): DecisionLogEntry[] {
    const batch = this.decisionLogsThisTick;
    this.decisionLogsThisTick = [];
    return batch;
  }

  private trackCreatedSignal(record: SignalRecord): void {
    this.signalsCreatedThisTick.push(record);
    if (record.outcome !== "pending") this.signalsResolvedThisTick.push(record);
  }

  private trackResolvedSignals(resolved: SignalRecord[]): void {
    for (const s of resolved) this.signalsResolvedThisTick.push(s);
  }

  private emitWorldEvent(event: Omit<WorldEvent, "id">): void {
    const full: WorldEvent = { id: this.nextId(), ...event };
    this.recentWorldEvents.push(full);
    if (this.recentWorldEvents.length > this.worldEventsCap) this.recentWorldEvents.shift();
    this.hooks.onWorldEvent?.(full);
  }

  private rotateObservedCohort(): void {
    const n = getSimConstants().decision_log.sampled_creatures_count;
    const alive = this.aliveCreatures();
    this.observedCohort = new Set();
    for (let i = 0; i < Math.min(n, alive.length); i++) {
      this.observedCohort.add(this.rng.choice(alive).id);
    }
  }

  private shouldLogDecision(creatureId: string): boolean {
    if (this.observedCohort.has(creatureId)) return true;
    const until = this.eventWindowUntil.get(creatureId);
    return until !== undefined && this.tick_ <= until;
  }

  private markEventWindow(creatureId: string): void {
    this.eventWindowUntil.set(creatureId, this.tick_ + 20);
  }

  /** Один тик — все 14 шагов А.3. */
  tick(): void {
    this.tick_ += 1;
    const dtRealSeconds = ticksToRealSeconds(1);

    // 1. applyPendingReflections()
    this.applyPendingReflections();

    // 2. advanceDayNight() (+ респавн рыбы — тикает вместе со средой, фаза 3)
    this.world.tick();
    const phase = this.world.dayNight.phase();
    const isNight = phase === "night";

    // 3. advanceBioClocks()
    this.advanceBioClocksStep(dtRealSeconds);

    // Единый снимок живых существ на начало шага 4 — переиспользуется до
    // конца тика (вместо повторного O(n) фильтра this.creatures на каждом
    // шаге, что было главной затратой на тик при живой популяции ~90-150
    // особей). Шаги, где существо может умереть В ЭТОМ ЖЕ тике (охота,
    // старость/голод уже позади), защищены проверкой isAlive().
    const alive = this.aliveCreatures();

    // Индекс соседей — нужен sense()/resolveActions/detectEvents.
    this.spatialIndex.rebuild(alive.map((c) => ({ id: c.id, x: c.pos.x, y: c.pos.y })));
    const byId = this.creatures;

    // 4. sense()
    const visibleByCreature = new Map<string, Creature[]>();
    for (const creature of alive) {
      const visible = sense(creature, this.spatialIndex, byId, phase, this.tick_, this.rng);
      reinforceVisiblePredatorThreat(creature, visible);
      visibleByCreature.set(creature.id, visible);
    }

    // 5. decide()
    const decisions = new Map<string, Decision>();
    for (const creature of alive) {
      const decision = this.decideFor(creature, visibleByCreature.get(creature.id) ?? [], phase, isNight);
      decisions.set(creature.id, decision);
      creature.actionCounts[decision.action] = (creature.actionCounts[decision.action] ?? 0) + 1;
      if (this.shouldLogDecision(creature.id)) {
        const entry: DecisionLogEntry = {
          creatureId: creature.id,
          tick: this.tick_,
          chosenAction: decision.action,
          factors: decision.factors,
        };
        this.decisionLog.push(entry);
        this.decisionLogsThisTick.push(entry);
        if (this.decisionLog.length > this.decisionLogCap) this.decisionLog.shift();
      }
    }

    // 6. resolveActions()
    const tickOutcomes: Array<{ creatureId: string; zone: ZoneName; score: number }> = [];
    const tickSkillGrowth: Array<{ creatureId: string; skill: keyof Creature["skills"] }> = [];
    this.resolveActionsStep(alive, decisions, visibleByCreature, isNight, tickOutcomes, tickSkillGrowth);

    // 7. detectEvents()
    this.detectEventsStep(decisions, visibleByCreature, byId);

    // 8. enqueueReflections() — фоновая, привязана к моменту сна (7.10); заглушка мгновенно готова следующий тик.
    this.enqueueReflectionsStep(decisions);

    // 9. updateBondsAndAversions()
    this.updateBondsAndAversionsStep(alive, visibleByCreature);

    // 10. updateSkillsAndHabits()
    for (const { creatureId, skill } of tickSkillGrowth) {
      const c = this.creatures.get(creatureId);
      if (c && isAlive(c)) growSkill(c, skill);
    }
    for (const { creatureId, zone, score } of tickOutcomes) {
      const c = this.creatures.get(creatureId);
      if (c && isAlive(c)) updateHabit(c, zone, score);
    }
    for (const creature of alive) {
      if (isAlive(creature)) decaySkills(creature, dtRealSeconds);
    }

    // 11. updateAuthority() — раз во внутренние сутки (~3.4 реальных часа,
    // time.inner_day_real_hours — НЕ realDaysToTicks(1), это был бы один
    // полный реальный день, в 7 раз реже требуемого; day_night.ticksPerDay()
    // уже считает именно внутренние сутки, см. world/dayNight.ts).
    const ticksPerInnerDay = this.world.dayNight.ticksPerDay();
    if (this.tick_ % ticksPerInnerDay === 0) {
      for (const creature of alive) {
        if (isAlive(creature)) creature.authority = computeAuthority(creature, ageWeeksAt(creature.bornAtTick, this.tick_));
      }
      this.rotateObservedCohort();
    }

    // 12. decayPerceivedStates()
    for (const creature of alive) {
      if (!isAlive(creature)) continue;
      const visibleIds = new Set((visibleByCreature.get(creature.id) ?? []).map((c) => c.id));
      decayPerceivedStates(
        creature,
        (subjectId) => {
          const subject = this.creatures.get(subjectId);
          if (!subject || !isAlive(subject)) return undefined;
          return trueVigor(subject, subject.ageStage);
        },
        visibleIds,
      );
    }
    decayAversions(this.aversions, dtRealSeconds);
    for (const creature of alive) {
      if (isAlive(creature)) decayEpisodeSignificance(creature, dtRealSeconds);
    }
    this.pruneRecentPredation();
    this.pruneHuntCooldowns();

    // Реинтродукция при полном вымирании вида (7.4) — после всех смертей тика.
    this.checkReintroductionStep();

    // 13. broadcastDelta() — хук без реализации в фазе 4 (наблюдение — фаза 5).
    // 14. persistSnapshot() — хук без реализации в фазе 4 (БД — вне рамок; см. ops/DEVIATIONS.md).
  }

  /** Плотность рыбы для персистентности (world_clock.fish_density). */
  fishDensitySnapshot(): FishDensitySnapshot {
    return this.world.fish.snapshot();
  }

  private countAlive(species: Species): number {
    let n = 0;
    for (const c of this.creatures.values()) {
      if (isAlive(c) && c.species === species) n += 1;
    }
    return n;
  }

  private checkReintroductionStep(): void {
    const result = processReintroduction({
      tick: this.tick_,
      rng: this.rng,
      nameGen: this.nameGen,
      nextId: this.nextId,
      ticksPerInnerDay: this.world.dayNight.ticksPerDay(),
      countAlive: (species) => this.countAlive(species),
      lastReintroductionTick: this.lastReintroductionTick,
    });
    this.lastReintroductionTick = result.lastReintroductionTick;
    for (const creature of result.creatures) this.creatures.set(creature.id, creature);
    for (const event of result.events) {
      this.emitWorldEvent({
        tick: event.tick,
        type: "reintroduction",
        zone: event.species === "penguin" ? "main_ice" : "open_water",
        payload: { species: event.species, count: event.count, reason: "extinction" },
      });
      console.warn(
        `[sim-engine] РЕИНТРОДУКЦИЯ ${event.species}: +${event.count} особей на тике ${event.tick} — провал балансировки, см. ops/BALANCE_LOG.md`,
      );
    }
  }

  // ---- шаг 3 ----
  private advanceBioClocksStep(dtRealSeconds: number): void {
    for (const creature of this.aliveCreatures()) {
      const hasFriend = this.hasAnyFriend(creature.id);
      const result = advanceBioClocks(creature, dtRealSeconds, hasFriend);
      if (result.starvedToDeath) {
        this.killCreature(creature, "starvation");
        continue;
      }
      if (rollOldAgeDeath(creature, this.tick_, this.rng)) {
        this.killCreature(creature, "age");
        continue;
      }
      const newStage = ageStageFor(creature.species, ageWeeksAt(creature.bornAtTick, this.tick_));
      if (newStage !== creature.ageStage) {
        const type = newStage === "adult" ? "matured" : "grew_old";
        creature.ageStage = newStage;
        this.episodesThisTick.push(
          recordEpisode(creature, this.tick_, { type, participants: [creature.id], significance: getSimConstants().episode_significance[type] }, this.nextId),
        );
        this.emitWorldEvent({ tick: this.tick_, type, actorId: creature.id, zone: creature.zone, payload: {} });
        this.markEventWindow(creature.id);
      }
    }
  }

  private hasAnyFriend(creatureId: string): boolean {
    for (const record of this.bonds.values()) {
      if (record.kind === "friend" && (record.creatureA === creatureId || record.creatureB === creatureId)) return true;
    }
    return false;
  }

  // ---- шаг 5 ----
  private decideFor(creature: Creature, visible: Creature[], phase: "day" | "night", _isNight: boolean): Decision {
    const ctx: DecideContext = {
      creature,
      currentTick: this.tick_,
      phase,
      visible,
      fishAvailability: (zone: ZoneName) => this.world.fish.availability(zone, phase === "night"),
      bondStrength: bondStrengthLookup(this.bonds, creature.id),
      aversionStrength: aversionStrengthLookup(this.aversions, creature.id),
      rng: this.rng,
      visibilityMultiplier: (id: string) => this.visibilityMultiplierFor(id),
    };
    return decide(ctx);
  }

  private guardedOffspringThisTick = new Set<string>();
  private visibilityBoostThisTick = new Map<string, number>();
  private coordinatedPreyThisTick = new Map<string, Set<string>>();
  /**
   * (orcaId|preyId) -> тик последней попытки охоты этой касатки на эту
   * конкретную жертву. Касатка в воде БЫСТРЕЕ пингвина (22 vs 14 у.е./тик,
   * А.10) — попав в радиус контакта, жертва физическим бегством оторваться
   * не может, поэтому без кулдауна одна и та же пара резолвилась бы на
   * КАЖДОМ тике подряд, пока преследование не закончится успехом (P->1 по
   * мере накопления бросков, что противоречит "результативна, но не
   * тотальна" из А.10 — это и обнажили первые тестовые прогоны, где
   * genesis-популяция пингвинов вымирала за 1-3 внутренних суток). Кулдаун
   * даёт промаху реальный смысл — жертва получает окно, чтобы физически
   * уйти на дистанцию/спрятаться, прежде чем ТА ЖЕ касатка попробует снова
   * (см. ops/DEVIATIONS.md и ops/BALANCE_LOG.md, фаза 4). Другую видимую
   * жертву касатка может атаковать в тот же тик без ограничения.
   */
  private lastHuntAttemptTick = new Map<string, number>();
  /** Кулдаун срыва сближения (group/guard pre_contact). */
  private lastHuntBreakTick = new Map<string, number>();

  private visibilityMultiplierFor(creatureId: string): number {
    return this.visibilityBoostThisTick.get(creatureId) ?? 1;
  }

  private tryHuntContact(
    orca: Creature,
    target: Creature | undefined,
    tickSkillGrowth: Array<{ creatureId: string; skill: keyof Creature["skills"] }>,
    tickOutcomes: Array<{ creatureId: string; zone: ZoneName; score: number }>,
  ): void {
    if (!target || !isAlive(target)) return;
    if (distance(orca.pos, target.pos) > getSimConstants().hunting.contact_radius_units) return;
    const pairKey = `${orca.id}|${target.id}`;
    const last = this.lastHuntAttemptTick.get(pairKey);
    const cooldownTicks = Math.round(realHoursToTicks(getSimConstants().hunting.reattempt_cooldown_real_minutes / 60));
    if (last !== undefined && this.tick_ - last < cooldownTicks) return;
    this.lastHuntAttemptTick.set(pairKey, this.tick_);
    this.resolveHuntAttempt(orca, target, tickSkillGrowth, tickOutcomes);
  }

  // ---- шаг 6 ----
  private resolveActionsStep(
    alive: Creature[],
    decisions: Map<string, Decision>,
    visibleByCreature: Map<string, Creature[]>,
    isNight: boolean,
    tickOutcomes: Array<{ creatureId: string; zone: ZoneName; score: number }>,
    tickSkillGrowth: Array<{ creatureId: string; skill: keyof Creature["skills"] }>,
  ): void {
    this.guardedOffspringThisTick = new Set();
    this.visibilityBoostThisTick = new Map();
    this.coordinatedPreyThisTick = new Map();
    const bounds = { width: this.world.width, height: this.world.height };

    // Первый проход: сигналы, сон, guard/provision/coordinate_hunt регистрация — до охоты.
    for (const creature of alive) {
      const decision = decisions.get(creature.id);
      if (!decision) continue;
      resolveSleepToggle(creature, decision.action);

      if (decision.action === "guard_offspring" && decision.targetId) {
        this.guardedOffspringThisTick.add(decision.targetId);
        this.visibilityBoostThisTick.set(creature.id, getSimConstants().kinship.guard_offspring.parent_visibility_multiplier);
        tickSkillGrowth.push({ creatureId: creature.id, skill: "parenting" });
      }
      if (decision.action === "coordinate_hunt" && decision.targetId) {
        const set = this.coordinatedPreyThisTick.get(decision.targetId) ?? new Set<string>();
        set.add(creature.id);
        this.coordinatedPreyThisTick.set(decision.targetId, set);
      }
      if (decision.action === "alarm_call") {
        this.visibilityBoostThisTick.set(
          creature.id,
          Math.max(this.visibilityMultiplierFor(creature.id), getSimConstants().signaling.alarm_call_visibility_multiplier),
        );
      }
    }

    // Notice → flee: удача до контакта (evasion × threat), commit flee в этом тике.
    const contactR = getSimConstants().hunting.contact_radius_units;
    const approachBand = contactR + getSimConstants().hunting.pre_contact.approach_band_extra_units;
    const steerCommit = getSimConstants().movement.steering.action_commit_ticks;
    for (const creature of alive) {
      if (!isAlive(creature) || creature.species !== "orca") continue;
      const decision = decisions.get(creature.id);
      if (!decision?.targetId) continue;
      if (decision.action !== "hunt" && decision.action !== "stealth_approach" && decision.action !== "coordinate_hunt") continue;
      const prey = this.creatures.get(decision.targetId);
      if (!prey || !isAlive(prey) || prey.species !== "penguin") continue;
      const dist = distance(creature.pos, prey.pos);
      if (dist > approachBand) continue;
      if (!rollHuntNotice(creature, prey, this.tick_, this.rng)) continue;
      bumpPreyThreatOfOrca(prey, creature, getSimConstants().hunting.prey_threat.hunt_bump);
      decisions.set(prey.id, {
        action: "flee",
        targetId: creature.id,
        zone: prey.zone,
        factors: [{ action: "flee", utility: 1, breakdown: { noticed_in_advance: 1 } }],
      });
      prey.actionCommitTicks = steerCommit;
      prey.actionCounts.flee = (prey.actionCounts.flee ?? 0) + 1;
    }

    // Второй проход: движение + действия с исходом. Существо могло быть
    // убито ранее В ЭТОМ ЖЕ проходе (стало жертвой другой касатки) —
    // пропускаем, иначе мёртвый пингвин продолжил бы "действовать".
    for (const creature of alive) {
      if (!isAlive(creature)) continue;
      const decision = decisions.get(creature.id);
      if (!decision) continue;
      const target = decision.targetId ? this.creatures.get(decision.targetId) : undefined;
      const targetPos = movementTargetPos(decision.action, decision.zone, target && isAlive(target) ? target : undefined);
      resolveMovement(creature, decision.action, decision.zone, targetPos, bounds, this.tick_, this.rng);

      switch (decision.action) {
        case "eat": {
          const result = resolveEat(creature, this.world.fish, isNight, this.tick_, this.rng);
          tickOutcomes.push({ creatureId: creature.id, zone: creature.zone, score: result.success ? 1 : -0.3 });
          if (result.success) {
            tickSkillGrowth.push({ creatureId: creature.id, skill: "foraging" });
            this.emitWorldEvent({ tick: this.tick_, type: "forage_success", actorId: creature.id, zone: creature.zone, payload: {} });
          }
          break;
        }
        case "socialize":
        case "approach":
        case "court": {
          tickSkillGrowth.push({ creatureId: creature.id, skill: "socializing" });
          tickOutcomes.push({ creatureId: creature.id, zone: creature.zone, score: 0.3 });
          break;
        }
        case "sleep": {
          tickOutcomes.push({ creatureId: creature.id, zone: creature.zone, score: 0.2 });
          break;
        }
        case "display_vigor": {
          if (target && isAlive(target)) {
            const record = resolveSignal(
              creature,
              "display_vigor",
              creature.zone,
              trueVigor(creature, creature.ageStage),
              1,
              [target],
              this.tick_,
              SIGNAL_RESOLVE_WINDOW_TICKS_FN(),
              this.nextId,
            );
            this.pendingSignals.push(record);
            this.trackCreatedSignal(record);
            this.acc.signalsSent["display_vigor"] = (this.acc.signalsSent["display_vigor"] ?? 0) + 1;
            // Наблюдаемость (6.1): подача display_vigor должна быть заметна на карте,
            // не только в служебной таблице signals.
            this.emitWorldEvent({ tick: this.tick_, type: "signal_sent", actorId: creature.id, targetId: target.id, zone: creature.zone, payload: { signalType: "display_vigor" } });
          }
          break;
        }
        case "alarm_call": {
          // Слух ≠ зрение: получатели alarm_call — диск hearing_radius, не sense().
          const hearR = hearingRange(creature);
          const withinHearing = this.spatialIndex
            .queryRadius(creature.pos.x, creature.pos.y, hearR, creature.id)
            .map((p) => this.creatures.get(p.id))
            .filter((c): c is Creature => !!c && isAlive(c));
          const audience = withinHearing.filter((v) => v.species === "penguin");
          // true_state: видит ли кричавший касатку (зрение).
          const orcaVisible = (visibleByCreature.get(creature.id) ?? []).some((v) => v.species === "orca");
          const record = resolveSignal(
            creature,
            "alarm_call",
            creature.zone,
            orcaVisible ? 1 : 0,
            1,
            audience,
            this.tick_,
            SIGNAL_RESOLVE_WINDOW_TICKS_FN(),
            this.nextId,
          );
          this.pendingSignals.push(record);
          this.trackCreatedSignal(record);
          this.acc.signalsSent["alarm_call"] = (this.acc.signalsSent["alarm_call"] ?? 0) + 1;
          // Наблюдаемость (6.1): "тревога — самое драматичное, что происходит
          // в этом мире, и её нельзя оставлять только в логах".
          this.emitWorldEvent({ tick: this.tick_, type: "signal_sent", actorId: creature.id, zone: creature.zone, payload: { signalType: "alarm_call" } });
          const woken = wakeSleepersOnAlarm(creature, audience, this.rng);
          for (const w of woken) {
            this.episodesThisTick.push(
              recordEpisode(w, this.tick_, { type: "woken_by_alarm", participants: [creature.id], significance: getSimConstants().episode_significance.woken_by_alarm, zone: creature.zone }, this.nextId),
            );
            this.emitWorldEvent({ tick: this.tick_, type: "woken_by_alarm", actorId: creature.id, targetId: w.id, zone: creature.zone, payload: {} });
          }
          break;
        }
        case "provision": {
          if (target && isAlive(target)) {
            const result = resolveProvision(creature, target, this.rng);
            if (result.success) {
              tickSkillGrowth.push({ creatureId: creature.id, skill: "parenting" });
              this.acc.provisionEpisodes += 1;
              this.emitWorldEvent({ tick: this.tick_, type: "provisioned", actorId: creature.id, targetId: target.id, zone: creature.zone, payload: {} });
            }
          }
          break;
        }
        case "stealth_approach": {
          if (target && isAlive(target)) {
            resolveStealthApproach(creature, target, this.tick_);
            const record = resolveSignal(creature, "stealth_approach", target.zone, 1, 0, [target], this.tick_, 0, this.nextId);
            record.outcome = "disconfirmed"; // "Всегда по существу" (7.8.2) — известно сразу.
            this.trackCreatedSignal(record);
            this.acc.signalsSent["stealth_approach"] = (this.acc.signalsSent["stealth_approach"] ?? 0) + 1;
            this.acc.signalsDisconfirmed["stealth_approach"] = (this.acc.signalsDisconfirmed["stealth_approach"] ?? 0) + 1;
          }
          // Контакт резолвится после pre_contact defense (ниже).
          break;
        }
        case "hunt":
        case "coordinate_hunt":
          // Контакт = смерть; резолв после pre_contact (срыв group/guard).
          break;
        default:
          break;
      }

      creature.activity = deriveActivity(creature, decision.action, this.tick_);
      creature.lastAction = decision.action;
    }

    // Удача до контакта: group/guard оттесняют жертву; coordinate отменяет.
    const broken = applyPreContactDefense(
      alive.filter(isAlive),
      decisions,
      this.guardedOffspringThisTick,
      this.coordinatedPreyThisTick,
      bounds,
      this.lastHuntBreakTick,
      this.tick_,
    );
    for (const b of broken) {
      const orca = this.creatures.get(b.orcaId);
      const prey = this.creatures.get(b.preyId);
      if (!orca || !prey || !isAlive(prey)) continue;
      this.emitWorldEvent({
        tick: this.tick_,
        type: "hunt_attempt",
        actorId: orca.id,
        targetId: prey.id,
        zone: prey.zone,
        payload: { caught: false, broken_approach: true },
      });
      applyEmotionDelta(orca, EMOTION_DELTAS.hunt_fail_orca);
      applyEmotionDelta(prey, EMOTION_DELTAS.hunt_survived_prey);
      tickOutcomes.push({ creatureId: orca.id, zone: prey.zone, score: -0.3 });
      tickOutcomes.push({ creatureId: prey.id, zone: prey.zone, score: -1 });
      tickSkillGrowth.push({ creatureId: prey.id, skill: "evasion" });
      this.episodesThisTick.push(
        recordEpisode(orca, this.tick_, { type: "hunt_attempt_failed_by_hunter", participants: [prey.id], significance: getSimConstants().episode_significance.hunt_attempt_failed_by_hunter, zone: prey.zone }, this.nextId),
      );
      recordAversion(this.aversions, prey.id, orca.id, getSimConstants().episode_significance.hunt_attempt_survived_by_prey);
      this.episodesThisTick.push(
        recordEpisode(prey, this.tick_, { type: "hunt_attempt_survived_by_prey", participants: [orca.id], significance: getSimConstants().episode_significance.hunt_attempt_survived_by_prey, zone: prey.zone }, this.nextId),
      );
      this.markEventWindow(prey.id);
      // Кулдаун пары — окно уйти после срыва.
      this.lastHuntAttemptTick.set(`${orca.id}|${prey.id}`, this.tick_);
    }

    // Касание при охоте = смерть (после возможного срыва).
    for (const creature of alive) {
      if (!isAlive(creature) || creature.species !== "orca") continue;
      const decision = decisions.get(creature.id);
      if (!decision?.targetId) continue;
      if (decision.action !== "hunt" && decision.action !== "stealth_approach" && decision.action !== "coordinate_hunt") continue;
      const target = this.creatures.get(decision.targetId);
      this.tryHuntContact(creature, target, tickSkillGrowth, tickOutcomes);
    }

    applySoftSeparation(
      alive.filter(isAlive),
      decisions,
      bounds,
      this.spatialIndex,
    );
  }

  private resolveHuntAttempt(
    orca: Creature,
    prey: Creature,
    tickSkillGrowth: Array<{ creatureId: string; skill: keyof Creature["skills"] }>,
    tickOutcomes: Array<{ creatureId: string; zone: ZoneName; score: number }>,
  ): void {
    const visiblePrey = (this.spatialIndex.queryRadius(prey.pos.x, prey.pos.y, getSimConstants().social.bond_proximity_radius_units, prey.id) ?? [])
      .map((p) => this.creatures.get(p.id))
      .filter((c): c is Creature => !!c && isAlive(c) && c.species === prey.species);
    const groupProtected = visiblePrey.length + 1 >= 3;
    const guarded = this.guardedOffspringThisTick.has(prey.id);
    const coordinated = (this.coordinatedPreyThisTick.get(prey.id)?.size ?? 0) > 0;

    const outcome = resolveHunt(orca, prey, { guarded, coordinated, groupProtected }, this.tick_, this.rng);
    bumpPreyThreatOfOrca(prey, orca, getSimConstants().hunting.prey_threat.hunt_bump);
    this.emitWorldEvent({ tick: this.tick_, type: "hunt_attempt", actorId: orca.id, targetId: prey.id, zone: prey.zone, payload: { caught: outcome.caught } });

    this.recentPredation.push({ zone: prey.zone, tick: this.tick_ });

    const pendingForPrey = this.pendingSignals.filter((s) => s.senderId === prey.id && s.type === "display_vigor" && s.outcome === "pending");
    if (pendingForPrey.length > 0) {
      const resolved = resolveDisplayVigorAgainstHunt(prey, orca, pendingForPrey, outcome.caught, outcome.noticedInAdvance);
      this.trackResolvedSignals(resolved);
      for (const s of resolved) {
        if (s.outcome === "disconfirmed") {
          this.acc.signalsDisconfirmed["display_vigor"] = (this.acc.signalsDisconfirmed["display_vigor"] ?? 0) + 1;
        }
      }
    }

    if (outcome.caught) {
      applyEmotionDelta(orca, EMOTION_DELTAS.hunt_success_orca);
      this.emitWorldEvent({ tick: this.tick_, type: "hunt_success", actorId: orca.id, targetId: prey.id, zone: prey.zone, payload: {} });
      tickSkillGrowth.push({ creatureId: orca.id, skill: "hunting" });
      if (coordinated) {
        for (const partnerId of this.coordinatedPreyThisTick.get(prey.id) ?? []) {
          if (partnerId !== orca.id) tickSkillGrowth.push({ creatureId: partnerId, skill: "hunting" });
        }
        this.acc.coordinatedHunts += 1;
      }
      this.episodesThisTick.push(
        recordEpisode(orca, this.tick_, { type: "hunt_success", participants: [prey.id], significance: getSimConstants().episode_significance.hunt_success, zone: prey.zone }, this.nextId),
      );
      tickOutcomes.push({ creatureId: orca.id, zone: prey.zone, score: 1 });
      this.killCreature(prey, "predation");
      if (guarded) this.acc.guardEpisodes += 1;
    } else {
      applyEmotionDelta(orca, EMOTION_DELTAS.hunt_fail_orca);
      applyEmotionDelta(prey, EMOTION_DELTAS.hunt_survived_prey);
      tickOutcomes.push({ creatureId: orca.id, zone: prey.zone, score: -0.3 });
      this.episodesThisTick.push(
        recordEpisode(orca, this.tick_, { type: "hunt_attempt_failed_by_hunter", participants: [prey.id], significance: getSimConstants().episode_significance.hunt_attempt_failed_by_hunter, zone: prey.zone }, this.nextId),
      );

      tickSkillGrowth.push({ creatureId: prey.id, skill: "evasion" });
      tickOutcomes.push({ creatureId: prey.id, zone: prey.zone, score: -1 });
      recordAversion(this.aversions, prey.id, orca.id, getSimConstants().episode_significance.hunt_attempt_survived_by_prey);
      const preyEpisode = recordEpisode(
        prey,
        this.tick_,
        { type: "hunt_attempt_survived_by_prey", participants: [orca.id], significance: getSimConstants().episode_significance.hunt_attempt_survived_by_prey, zone: prey.zone },
        this.nextId,
      );
      this.episodesThisTick.push(preyEpisode);
      this.markEventWindow(prey.id);
      const { witnesses, friends } = this.witnessesAndFriendsOf(prey, visiblePrey);
      const propagated = propagateSocialLearning(prey, preyEpisode, witnesses, friends, this.tick_, this.nextId);
      this.episodesThisTick.push(...propagated);
      this.acc.totalEpisodesCreated += propagated.length + 1;
      for (const ep of propagated) if (ep.transmissionDepth >= 2) this.acc.transmissionDepth2Plus += 1;
    }
  }

  // ---- смерть (общая точка) ----
  private killCreature(creature: Creature, cause: "age" | "starvation" | "predation"): void {
    creature.diedAtTick = this.tick_;
    creature.deathCause = cause;
    this.acc.deaths[creature.species][cause] = (this.acc.deaths[creature.species][cause] ?? 0) + 1;
    // species/bornAtTick в payload — не для наблюдателя (тому хватает cause), а для
    // метрики продолжительности жизни (6.1, А.7/фаза 7): index.ts считает возраст
    // на момент смерти из этого события, не запрашивая creatures отдельно.
    this.emitWorldEvent({
      tick: this.tick_,
      type: "death",
      actorId: creature.id,
      zone: creature.zone,
      payload: { cause, species: creature.species, bornAtTick: creature.bornAtTick },
    });

    // Свидетели смерти — кто видит тело (visionRange фазы/сна), не всегда .day.
    const phase = this.world.dayNight.phase();
    const queryR = getSimConstants().day_night.perception_radius[creature.species][phase];
    const nearby = this.spatialIndex
      .queryRadius(creature.pos.x, creature.pos.y, queryR, creature.id)
      .map((p) => this.creatures.get(p.id))
      .filter((c): c is Creature => !!c && isAlive(c) && c.species === creature.species)
      .filter((c) => distance(creature.pos, c.pos) <= visionRange(c, phase));
    const { witnesses, friends } = this.witnessesAndFriendsOf(creature, nearby);
    const friendThreshold = getSimConstants().social.friendship.threshold;
    for (const witness of witnesses) {
      if (bondStrengthLookup(this.bonds, witness.id)(creature.id) >= friendThreshold) {
        applyEmotionDelta(witness, EMOTION_DELTAS.friend_died);
      }
    }

    if (witnesses.length > 0 || friends.length > 0) {
      const virtualEpisode = {
        id: "virtual",
        creatureId: creature.id,
        tick: this.tick_,
        type: "friend_died" as const,
        participants: [creature.id],
        significance: getSimConstants().episode_significance.friend_died,
        consumedByReflection: false,
        transmissionDepth: 0,
        coreMemory: true,
        zone: creature.zone,
      };
      // Источник переиспользует authority умершего (снимок на момент смерти).
      const propagated = propagateSocialLearning({ ...creature, authority: creature.authority }, virtualEpisode, witnesses, friends, this.tick_, this.nextId);
      this.episodesThisTick.push(...propagated);
      this.acc.totalEpisodesCreated += propagated.length;
      for (const ep of propagated) if (ep.transmissionDepth >= 2) this.acc.transmissionDepth2Plus += 1;
    }

    this.creatures.delete(creature.id);
  }

  private witnessesAndFriendsOf(creature: Creature, nearbySameSpecies: Creature[]): { witnesses: Creature[]; friends: Creature[] } {
    const witnesses = nearbySameSpecies.filter((c) => c.id !== creature.id);
    const witnessIds = new Set(witnesses.map((w) => w.id));
    const friends: Creature[] = [];
    for (const record of this.bonds.values()) {
      if (record.kind !== "friend") continue;
      let otherId: string | undefined;
      if (record.creatureA === creature.id) otherId = record.creatureB;
      else if (record.creatureB === creature.id) otherId = record.creatureA;
      if (!otherId || witnessIds.has(otherId)) continue;
      const other = this.creatures.get(otherId);
      if (other && isAlive(other)) friends.push(other);
    }
    return { witnesses, friends };
  }

  // ---- шаг 7 ----
  private detectEventsStep(decisions: Map<string, Decision>, visibleByCreature: Map<string, Creature[]>, byId: Map<string, Creature>): void {
    // Разрешение alarm_call по истечении окна.
    const expiredAlarms = this.pendingSignals.filter((s) => s.type === "alarm_call" && s.outcome === "pending" && this.tick_ >= s.resolveByTick);
    if (expiredAlarms.length > 0) {
      const resolvedAlarms = resolveAlarmCallsOnExpiry(expiredAlarms, this.tick_, byId, (zone, sinceTick) =>
        this.recentPredation.some((p) => p.zone === zone && p.tick >= sinceTick),
      );
      this.trackResolvedSignals(resolvedAlarms);
      for (const s of resolvedAlarms) {
        if (s.outcome === "disconfirmed") this.acc.signalsDisconfirmed["alarm_call"] = (this.acc.signalsDisconfirmed["alarm_call"] ?? 0) + 1;
      }
    }
    // Незакрытые display_vigor по истечении окна — не опровергнуты, значит подтверждены (7.8.4: бездоказательности недостаточно для опровержения).
    const expiredVigor = this.pendingSignals.filter((s) => s.type === "display_vigor" && s.outcome === "pending" && this.tick_ >= s.resolveByTick);
    for (const s of expiredVigor) {
      s.outcome = "confirmed";
      for (const receiverId of s.receivers) {
        const receiver = byId.get(receiverId);
        if (receiver) applyTrustUpdate(receiver, s.senderId, true);
      }
    }
    this.trackResolvedSignals(expiredVigor);
    this.pendingSignals = this.pendingSignals.filter((s) => s.outcome === "pending");

    // Courtship changes a sufficiently strong bond into a mate bond; a
    // rejected court attempt becomes a small, directed social injury.
    this.processCourtship(decisions, byId);

    // Reproduction — проверка допустимых пар среди друзей/партнёров.
    this.processReproduction(byId);

    // guard_offspring: episode для родителя (охрана сама по себе — значимое событие только при реальной угрозе; здесь фиксируем факт как часть kinship-метрик).
    for (const [creatureId, decision] of decisions) {
      if (decision.action !== "guard_offspring") continue;
      const parent = byId.get(creatureId);
      if (parent) this.emitWorldEvent({ tick: this.tick_, type: "guard_started", actorId: parent.id, targetId: decision.targetId, zone: parent.zone, payload: {} });
    }
  }

  private processCourtship(decisions: Map<string, Decision>, byId: Map<string, Creature>): void {
    const minBond = getSimConstants().reproduction.min_bond_strength_to_mate;
    const offenseStrength = getSimConstants().episode_significance.bond_broken;
    for (const [courtierId, decision] of decisions) {
      if (decision.action !== "court" || !decision.targetId) continue;
      const courtier = byId.get(courtierId);
      const target = byId.get(decision.targetId);
      if (!courtier || !target || !isAlive(courtier) || !isAlive(target)) continue;
      const record = this.bonds.get(bondKey(courtier.id, target.id));
      if (!record || record.strength < minBond) {
        if (!this.aversions.has(aversionKey(courtier.id, target.id))) {
          recordAversion(this.aversions, courtier.id, target.id, offenseStrength);
          this.emitWorldEvent({
            tick: this.tick_,
            type: "offense",
            actorId: courtier.id,
            targetId: target.id,
            zone: courtier.zone,
            payload: { reason: "court_rejected" },
          });
        }
        continue;
      }
      if (record.kind !== "mate") {
        record.kind = "mate";
        this.emitWorldEvent({ tick: this.tick_, type: "mate_bonded", actorId: courtier.id, targetId: target.id, zone: courtier.zone, payload: {} });
      }
    }
  }

  private processReproduction(byId: Map<string, Creature>): void {
    const constants = getSimConstants();
    for (const record of this.bonds.values()) {
      if (record.kind !== "friend" && record.kind !== "mate") continue;
      const a = byId.get(record.creatureA);
      const b = byId.get(record.creatureB);
      if (!a || !b || !isAlive(a) || !isAlive(b)) continue;
      const check = canMate(a, b, {
        ageStageA: a.ageStage,
        ageStageB: b.ageStage,
        bondStrength: record.strength,
        currentTick: this.tick_,
      });
      if (!check) continue;
      if (!this.rng.bool(constants.reproduction.attempt_probability_per_tick)) continue;

      const offspring = createOffspring(a, b, this.tick_, this.rng, this.nameGen, this.nextId);
      a.lastReproducedAtTick = this.tick_;
      b.lastReproducedAtTick = this.tick_;
      const newlyBonded = record.kind !== "mate";
      record.kind = "mate";
      this.creatures.set(offspring.id, offspring);
      this.acc.births[offspring.species] += 1;
      if (newlyBonded) {
        this.emitWorldEvent({ tick: this.tick_, type: "mate_bonded", actorId: a.id, targetId: b.id, zone: a.zone, payload: {} });
      }

      for (const parent of [a, b]) {
        applyEmotionDelta(parent, EMOTION_DELTAS.birth_parent);
        this.episodesThisTick.push(
          recordEpisode(parent, this.tick_, { type: "birth", participants: [offspring.id], significance: constants.episode_significance.birth, zone: parent.zone }, this.nextId),
        );
      }
      this.emitWorldEvent({ tick: this.tick_, type: "birth", actorId: offspring.id, zone: offspring.zone, payload: { parentA: a.id, parentB: b.id } });
      this.markEventWindow(offspring.id);
    }
  }

  // ---- шаг 8 ----
  private enqueueReflectionsStep(decisions: Map<string, Decision>): void {
    if (this.hooks.mockReflectionEnabled === false) return;
    for (const [creatureId, decision] of decisions) {
      if (decision.action !== "sleep") continue;
      const creature = this.creatures.get(creatureId);
      if (!creature || !isAlive(creature)) continue;
      if (creature.ageStage === "juvenile") continue; // "рефлексия — только фоновая" уже подразумевается; детёныш всё равно получает фоновую по тому же правилу ниже.
      if (!shouldTriggerBackgroundReflection(creature, true, this.tick_)) continue;
      const result = generateMockReflection(creature);
      this.pendingReflections.push({ creatureId, result });
    }
  }

  // ---- шаг 1 (следующего тика, читает очередь из шага 8 предыдущего) ----
  private applyPendingReflections(): void {
    const batch = this.pendingReflections;
    this.pendingReflections = [];
    for (const { creatureId, result } of batch) {
      const creature = this.creatures.get(creatureId);
      if (!creature || !isAlive(creature)) continue; // существо умерло -> discard (7.3)
      applyTraitDeltas(creature, result.traitDeltas);
      applyWeightDeltas(creature, result.weightDeltas);
      creature.intentions = result.intentions;
      creature.narrative = result.narrative;
      creature.narrativeFacts = result.narrativeFacts;
      creature.lastReflectionAt = this.tick_;
    }
  }

  // ---- шаг 9 ----
  private updateBondsAndAversionsStep(alive: Creature[], visibleByCreature: Map<string, Creature[]>): void {
    const touched = new Set<string>();
    for (const creature of alive) {
      if (!isAlive(creature)) continue;
      const visible = visibleByCreature.get(creature.id) ?? [];
      for (const other of visible) {
        if (creature.id >= other.id) continue; // обрабатываем каждую пару один раз
        if (!isAlive(other)) continue;
        const key = `${creature.id}|${other.id}`;
        const before = this.bonds.get(key)?.strength ?? 0;
        const record = growBondForPair(creature, other, this.bonds);
        if (!record) continue;
        touched.add(key);
        if (before < getSimConstants().social.friendship.threshold && record.strength >= getSimConstants().social.friendship.threshold) {
          this.emitWorldEvent({ tick: this.tick_, type: "bond_formed", actorId: creature.id, targetId: other.id, zone: creature.zone, payload: {} });
          const transmitted = transmitOnBondFormed(creature, other, this.tick_, this.nextId);
          if (transmitted) this.episodesThisTick.push(transmitted);
        }
      }
    }
    const broken = decayUntouchedBonds(this.bonds, touched);
    for (const record of broken) {
      this.emitWorldEvent({ tick: this.tick_, type: "bond_broken", actorId: record.creatureA, targetId: record.creatureB, payload: {} });
      if (record.kind === "mate") {
        this.emitWorldEvent({ tick: this.tick_, type: "mate_breakup", actorId: record.creatureA, targetId: record.creatureB, payload: {} });
      }
    }
  }

  private pruneRecentPredation(): void {
    const cutoff = this.tick_ - Math.round(realHoursToTicks(2));
    this.recentPredation = this.recentPredation.filter((p) => p.tick >= cutoff);
  }

  /** Иначе lastHuntAttemptTick растёт неограниченно за многосуточный прогон (пары давно умерших особей). */
  private pruneHuntCooldowns(): void {
    const cutoff = this.tick_ - Math.round(realHoursToTicks((2 * getSimConstants().hunting.reattempt_cooldown_real_minutes) / 60));
    for (const [key, tick] of this.lastHuntAttemptTick) {
      if (tick < cutoff) this.lastHuntAttemptTick.delete(key);
    }
  }
}
