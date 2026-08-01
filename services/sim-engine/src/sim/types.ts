import type { ZoneName } from "../world/zones.js";

export type Species = "penguin" | "orca";
export type Sex = "m" | "f";
export type AgeStage = "juvenile" | "adult" | "old";
export type DeathCause = "age" | "starvation" | "predation";

/** Черты характера (-1..1), заданные при рождении, дрейфующие через рефлексию (7.3, 7.7). */
export interface Traits {
  courage: number;
  curiosity: number;
  sociability: number;
  aggression: number;
  caution: number;
  /** Склонность к подаче сигналов (7.8.5) — наследуется и мутирует. */
  expressiveness: number;
}

export const TRAIT_KEYS = [
  "courage",
  "curiosity",
  "sociability",
  "aggression",
  "caution",
  "expressiveness",
] as const;

/** Потребности (0..1): выше — хуже (голоднее/уставшее/сонливее), кроме energy (выше — лучше). */
export interface Needs {
  hunger: number;
  energy: number;
  social: number;
  sleep_pressure: number;
}

export interface Emotion {
  valence: number; // -1..1
  arousal: number; // 0..1
}

/** {foraging, evasion, socializing, hunting, parenting}: 0..0.9 (7.7). */
export interface Skills {
  foraging: number;
  evasion: number;
  socializing: number;
  hunting: number;
  parenting: number;
}

export const SKILL_KEYS = ["foraging", "evasion", "socializing", "hunting", "parenting"] as const;

/** Личная карта ожиданий по зонам (7.7, механизм 2): zone -> -1..1. */
export type Habits = Partial<Record<ZoneName, number>>;

/** Врождённый affect к виду: threat = опасность, value = пища/социальная ценность. */
export interface SpeciesAffect {
  threat: number;
  value: number;
}

/**
 * Базовые инстинкты от рождения (priors): как сильно чувствовать стимулы.
 * Не сценарий действий — стратегия из U(a) × обучение поверх.
 */
export interface Instincts {
  speciesAffect: Partial<Record<Species, SpeciesAffect>>;
  needDrive: {
    hungerSeekFood: number;
    hungerSeekPrey: number;
  };
  mediumBias: {
    land: number;
    water: number;
  };
}

export interface NeedWeights {
  hunger: number;
  energy: number;
  social: number;
  sleep: number;
}

/** Веса формулы attractiveness() касатки (7.8.3) — индивидуальны и дрейфуют. */
export interface HuntAttractivenessWeights {
  w_vigor: number;
  w_dist: number;
  w_group: number;
  w_stage: number;
}

/** Индивидуальные веса U(a) (А.4, 7.7, механизм 4). */
export interface DecisionWeights {
  w_need: NeedWeights;
  w_trait: number;
  w_skill: number;
  w_habit: number;
  /** Только у касаток — структура заложена под обе стороны механизма 7.8.4. */
  hunt_attractiveness?: HuntAttractivenessWeights;
}

export interface IntentionEffect {
  zone_penalty?: Partial<Record<ZoneName, number>>;
  zone_bonus?: Partial<Record<ZoneName, number>>;
  approach_bonus?: { creature: string; value: number };
  avoid_creature?: { creature: string; value: number };
  seek_mate?: boolean;
  /** Предпочтительная/нежелательная зона, валидируется reflection-worker. */
  prefer_zone?: ZoneName;
  avoid_zone?: ZoneName;
  /** UUID цели совместной охоты из намерения рефлексии. */
  hunt_with?: string;
}

export interface Intention {
  text: string;
  effect: IntentionEffect;
}

export type EpisodeType =
  | "friend_died"
  | "hunt_success"
  | "hunt_attempt_survived_by_prey"
  | "hunt_attempt_failed_by_hunter"
  | "birth"
  | "bond_formed"
  | "bond_broken"
  | "matured"
  | "grew_old"
  | "signal_disconfirmed_against_me"
  | "woken_by_alarm";

export interface Episode {
  id: string;
  creatureId: string;
  tick: number;
  type: EpisodeType;
  participants: string[];
  significance: number;
  consumedByReflection: boolean;
  /** NULL логически = пережито лично; иначе источник передачи (7.7, механизмы 3 и 5). */
  learnedFrom?: string;
  transmissionDepth: number;
  coreMemory: boolean;
  /** Зона, к которой относится эпизод (если применимо) — питает личные привычки (7.7, механизм 2) и традиции избегания. */
  zone?: ZoneName;
}

export type SignalType = "display_vigor" | "alarm_call" | "stealth_approach";
export type SignalOutcome = "pending" | "confirmed" | "disconfirmed";

export interface SignalRecord {
  id: string;
  senderId: string;
  tick: number;
  type: SignalType;
  zone: ZoneName | null;
  trueState: number;
  claimedState: number;
  outcome: SignalOutcome;
  receivers: string[];
  /** Тик, после которого сигнал разрешается в confirmed/disconfirmed, если ещё pending. */
  resolveByTick: number;
}

export interface PerceivedState {
  perceivedVigor: number;
  perceivedThreat: number;
  lastSignalTick: number;
}

export interface SignalTrustEntry {
  trust: number;
  confirmations: number;
  disconfirmations: number;
}

export interface WorldEvent {
  id: string;
  tick: number;
  type: string;
  actorId?: string;
  targetId?: string;
  zone?: ZoneName;
  payload: Record<string, unknown>;
}

export interface DecisionFactor {
  action: string;
  utility: number;
  breakdown: Record<string, number>;
}

export interface DecisionLogEntry {
  creatureId: string;
  tick: number;
  chosenAction: string;
  factors: DecisionFactor[];
}

export interface Vector2 {
  x: number;
  y: number;
}

export type Activity =
  | "sleep"
  | "walk"
  | "swim"
  | "hunt"
  | "forage"
  | "flee"
  | "transit_in"
  | "transit_out"
  | "idle";

/**
 * Существо (текущее состояние) — in-memory аналог таблицы `creatures`
 * (А.2). Персистентность в БД — вне рамок фазы 4 (см. ops/DEVIATIONS.md):
 * фаза 4 доказывает корректность механик через детерминированный
 * `simulate --fast`, не через запись каждого тика в Postgres.
 */
export interface Creature {
  id: string;
  species: Species;
  name: string;
  sex: Sex;
  bornAtTick: number;
  diedAtTick?: number;
  deathCause?: DeathCause;
  parentA?: string;
  parentB?: string;

  pos: Vector2;
  velocity: Vector2;
  zone: ZoneName;

  traits: Traits;
  traitsBirth: Traits;
  needs: Needs;
  emotion: Emotion;
  intentions: Intention[];
  /** Полный self-narrative — наблюдателю не отдаётся (6.1). */
  narrative?: string;

  skills: Skills;
  chronotype: number; // -1..1
  isAsleep: boolean;
  /** Кэш возрастной стадии — обновляется раз в тик, нужен для детекции переходов matured/grew_old. */
  ageStage: AgeStage;
  authority: number; // 0..1
  habits: Habits;
  /** Врождённые priors вида (+ mild parent overlay у newborn). */
  instincts: Instincts;
  weights: DecisionWeights;
  weightsBirth: DecisionWeights;
  lastReflectionAt: number;
  lastReproducedAtTick?: number;

  /** Часы непрерывного голодания при hunger=1.0 (реальные, для starvation timer, А.10). */
  continuousStarvationRealHours: number;
  /** Часы непрерывного бодрствования — используется для суточного планирования фоновой рефлексии. */
  awakeSinceTick: number;

  /** Действие, выбранное в ПРЕДЫДУЩЕМ тике — используется для интерполяции движения и метрик. */
  lastAction?: string;

  /** Текущий курс движения (рад), RAM-only — для плавного рулевого управления. */
  heading?: number;
  /** Оставшиеся тики удержания wander-курса (RAM-only). */
  wanderHeadingTicks?: number;
  /** Тики «закрепления» текущего действия (RAM-only). */
  actionCommitTicks?: number;
  /** Среда на прошлом тике — для transit_in/out (RAM-only). */
  lastMedium?: "ice" | "water";
  /** Тик, до которого держим transit_* (не включая); RAM-only. */
  transitUntilTick?: number;
  /** Наблюдаемый режим активности (персистится в light upsert). */
  activity?: Activity;

  episodes: Episode[];
  /** observer(this) -> subject_id -> perceived state (7.8.1). */
  perceivedStates: Map<string, PerceivedState>;
  perceivedZoneThreat: Map<ZoneName, number>;
  /** observer(this) -> signaler_id -> доверие (7.8.4). */
  trust: Map<string, SignalTrustEntry>;

  /** Для метрики поведенческой дивергенции когорт (цель 7, 7.7). */
  cohortId: string;
  actionCounts: Record<string, number>;

  narrativeFacts: string[];
}

export function isAlive(c: Creature): boolean {
  return c.diedAtTick === undefined;
}

export type BondKind = "friend" | "mate";

/** Симметричная связь, хранится по канонической паре creatureA < creatureB (А.2). */
export interface BondRecord {
  creatureA: string;
  creatureB: string;
  kind: BondKind;
  strength: number; // 0..1
}

/** Направленное избегание: subject боится/избегает object (А.2, НЕ симметрично). */
export interface AversionRecord {
  subjectId: string;
  objectId: string;
  strength: number; // 0..1
}

export function bondKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function aversionKey(subjectId: string, objectId: string): string {
  return `${subjectId}|${objectId}`;
}
