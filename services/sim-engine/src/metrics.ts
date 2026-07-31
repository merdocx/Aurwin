import http from "node:http";
import client from "prom-client";
import { ageWeeksAt } from "./sim/lifecycle.js";
import { SKILL_KEYS, type Creature, type Species, type WorldEvent } from "./sim/types.js";
import type { Phase } from "./world/dayNight.js";
import type { Simulation } from "./sim/simulation.js";

/**
 * Экспорт метрик Prometheus (ТЗ 6.1, А.7, фаза 7 «Эксплуатация»).
 *
 * Два источника обновления гейджей:
 *  - `recordWorldEvent` — событийно, из хука onWorldEvent в index.ts (только
 *    там, где нужна ОДНОРАЗОВАЯ фиксация исхода — продолжительность жизни
 *    при смерти; Histogram не умеет "установить" распределение целиком).
 *  - `setPopulationGauges` — раз в тик из index.ts: пересчитывает срезовые
 *    гейджи (население, навыки, сон, дивергенция, доверие) из живого
 *    состояния `Simulation`, и зеркалит уже посчитанные in-memory
 *    накопители `sim.acc` (births/deaths/signalsSent/... — см.
 *    simulation.ts) — эти поля и так кумулятивны с запуска процесса, читать
 *    их напрямую надёжнее, чем повторно инкрементировать по событиям.
 *
 * `/metrics` отдаёт уже посчитанное состояние registry — HTTP-обработчик
 * ничего не пересчитывает сам (пересчёт — только по тику), поэтому scrape
 * не блокирует и не замедляет тик-цикл (7.3, тот же принцип "симуляция не
 * блокируется" — здесь применён к обслуживанию Prometheus, а не LLM).
 */

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const currentTick = new client.Gauge({
  name: "aurwin_tick",
  help: "Номер текущего тика симуляции",
  registers: [register],
});

const lastTickTimestamp = new client.Gauge({
  name: "aurwin_last_tick_timestamp_seconds",
  help: "Unix-время последнего успешно завершённого тика (А.7: алёрт остановки тика > 2 мин)",
  registers: [register],
});

const population = new client.Gauge({
  name: "aurwin_population",
  help: "Текущая численность живых существ по видам (А.7, А.9: пингвины 10-120, касатки 2-12)",
  labelNames: ["species"],
  registers: [register],
});

const births = new client.Gauge({
  name: "aurwin_births_total",
  help: "Рождения по видам с момента запуска процесса (зеркало sim.acc.births)",
  labelNames: ["species"],
  registers: [register],
});

const deaths = new client.Gauge({
  name: "aurwin_deaths_total",
  help: "Смерти по видам и причинам с момента запуска процесса (зеркало sim.acc.deaths)",
  labelNames: ["species", "cause"],
  registers: [register],
});

const lifespanWeeks = new client.Histogram({
  name: "aurwin_lifespan_weeks",
  help: "Продолжительность жизни во внутренних неделях на момент смерти (6.2: пингвин 6-10, касатка 20-30)",
  labelNames: ["species"],
  buckets: [1, 2, 4, 6, 8, 10, 15, 20, 25, 30, 40, 60],
  registers: [register],
});

const nightPredationDeaths = new client.Counter({
  name: "aurwin_night_predation_deaths_total",
  help: "Смерти от хищника ночью (7.10) — числитель доли ночных смертей от хищника",
  registers: [register],
});

const behavioralDivergence = new client.Gauge({
  name: "aurwin_behavioral_divergence",
  help: "Средняя попарная total variation distance между распределениями действий особей одной когорты (7.7, цель 7) — должна расти с возрастом когорты",
  labelNames: ["species"],
  registers: [register],
});

const skillMean = new client.Gauge({
  name: "aurwin_skill_mean",
  help: "Среднее значение навыка по популяции вида (7.7)",
  labelNames: ["species", "skill"],
  registers: [register],
});

const skillStddev = new client.Gauge({
  name: "aurwin_skill_stddev",
  help: "Стандартное отклонение навыка по популяции вида — падение к нулю сигнализирует о вырождении специализации (6.1)",
  labelNames: ["species", "skill"],
  registers: [register],
});

const signalsSent = new client.Gauge({
  name: "aurwin_signals_sent_total",
  help: "Поданные сигналы по типам с момента запуска процесса (7.8, зеркало sim.acc.signalsSent)",
  labelNames: ["signal_type"],
  registers: [register],
});

const signalsDisconfirmed = new client.Gauge({
  name: "aurwin_signals_disconfirmed_total",
  help: "Опровергнутые постфактум сигналы по типам (7.8: доля неподтверждённых = это / signals_sent)",
  labelNames: ["signal_type"],
  registers: [register],
});

const trustAvg = new client.Gauge({
  name: "aurwin_trust_avg",
  help: "Средний кредит доверия по всем известным парам отправитель-получатель (7.8.4)",
  registers: [register],
});

const orcaWVigorAvg = new client.Gauge({
  name: "aurwin_orca_w_vigor_avg",
  help: "Средний вес w_vigor у касаток (7.8.3) — ход гонки вооружений скепсиса к сигналам",
  registers: [register],
});

const transmissionDepth2PlusRatio = new client.Gauge({
  name: "aurwin_transmission_depth2plus_ratio",
  help: "Доля эпизодов социального обучения с transmission_depth >= 2 от общего числа созданных эпизодов (7.7, механизм 5 — метрика традиции)",
  registers: [register],
});

const sleepingRatio = new client.Gauge({
  name: "aurwin_sleeping_ratio",
  help: "Доля спящих особей по виду и фазе суток (7.10)",
  labelNames: ["species", "phase"],
  registers: [register],
});

const avgSleepPressure = new client.Gauge({
  name: "aurwin_sleep_pressure_avg",
  help: "Среднее давление сна по виду (7.10)",
  labelNames: ["species"],
  registers: [register],
});

const guardEpisodes = new client.Gauge({
  name: "aurwin_guard_episodes_total",
  help: "Эпизоды guard_offspring с момента запуска процесса (7.9, зеркало sim.acc.guardEpisodes)",
  registers: [register],
});

const provisionEpisodes = new client.Gauge({
  name: "aurwin_provision_episodes_total",
  help: "Эпизоды provision с момента запуска процесса (7.9, зеркало sim.acc.provisionEpisodes)",
  registers: [register],
});

const coordinatedHunts = new client.Gauge({
  name: "aurwin_coordinated_hunts_total",
  help: "Кооперативные охоты касаток с момента запуска процесса (7.9, зеркало sim.acc.coordinatedHunts)",
  registers: [register],
});

const SPECIES: Species[] = ["penguin", "orca"];

function meanStddev(values: number[]): { mean: number; stddev: number } {
  if (values.length === 0) return { mean: 0, stddev: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return { mean, stddev: Math.sqrt(variance) };
}

/** Total variation distance (0..1) между двумя распределениями действий — простая, симметричная мера расстояния (7.7). */
function actionDistanceOf(a: Record<string, number>, b: Record<string, number>): number {
  const totalA = Object.values(a).reduce((s, v) => s + v, 0);
  const totalB = Object.values(b).reduce((s, v) => s + v, 0);
  if (totalA === 0 || totalB === 0) return 0;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let sum = 0;
  for (const key of keys) sum += Math.abs((a[key] ?? 0) / totalA - (b[key] ?? 0) / totalB);
  return sum / 2;
}

/** Средняя попарная дистанция действий внутри каждой когорты вида, усреднённая по когортам (7.7, цель 7). */
function cohortDivergence(creatures: Creature[]): number {
  const cohorts = new Map<string, Creature[]>();
  for (const c of creatures) {
    if (Object.keys(c.actionCounts).length === 0) continue;
    const list = cohorts.get(c.cohortId) ?? [];
    list.push(c);
    cohorts.set(c.cohortId, list);
  }
  const perCohort: number[] = [];
  for (const members of cohorts.values()) {
    if (members.length < 2) continue;
    let sum = 0;
    let pairs = 0;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        sum += actionDistanceOf(members[i].actionCounts, members[j].actionCounts);
        pairs++;
      }
    }
    if (pairs > 0) perCohort.push(sum / pairs);
  }
  if (perCohort.length === 0) return 0;
  return perCohort.reduce((s, v) => s + v, 0) / perCohort.length;
}

function avgTrust(creatures: Creature[]): number {
  let sum = 0;
  let count = 0;
  for (const c of creatures) {
    for (const entry of c.trust.values()) {
      sum += entry.trust;
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

/** Разрешает уровень значимости смерти по хищнику ночью для алёрта/наблюдения за 7.10. */
export function recordWorldEvent(event: WorldEvent, phase: Phase): void {
  if (event.type !== "death") return;
  const payload = event.payload as { cause?: string; species?: Species; bornAtTick?: number };
  if (!payload.species || payload.bornAtTick === undefined) return;
  const ageWeeks = ageWeeksAt(payload.bornAtTick, event.tick);
  lifespanWeeks.observe({ species: payload.species }, Math.max(0, ageWeeks));
  if (payload.cause === "predation" && phase === "night") nightPredationDeaths.inc();
}

export function setPopulationGauges(sim: Simulation): void {
  currentTick.set(sim.currentTick);
  lastTickTimestamp.set(Date.now() / 1000);

  const alive = sim.aliveCreatures();
  const phase = sim.world.dayNight.phase();
  const bySpecies: Record<Species, Creature[]> = { penguin: [], orca: [] };
  for (const c of alive) bySpecies[c.species].push(c);

  for (const species of SPECIES) {
    const group = bySpecies[species];
    population.set({ species }, group.length);
    births.set({ species }, sim.acc.births[species]);
    for (const [cause, count] of Object.entries(sim.acc.deaths[species])) {
      deaths.set({ species, cause }, count);
    }

    for (const skill of SKILL_KEYS) {
      const { mean, stddev } = meanStddev(group.map((c) => c.skills[skill]));
      skillMean.set({ species, skill }, mean);
      skillStddev.set({ species, skill }, stddev);
    }

    const asleep = group.filter((c) => c.isAsleep).length;
    sleepingRatio.set({ species, phase }, group.length > 0 ? asleep / group.length : 0);
    avgSleepPressure.set({ species }, meanStddev(group.map((c) => c.needs.sleep_pressure)).mean);

    behavioralDivergence.set({ species }, cohortDivergence(group));
  }

  for (const [signalType, count] of Object.entries(sim.acc.signalsSent)) {
    signalsSent.set({ signal_type: signalType }, count);
  }
  for (const [signalType, count] of Object.entries(sim.acc.signalsDisconfirmed)) {
    signalsDisconfirmed.set({ signal_type: signalType }, count);
  }

  trustAvg.set(avgTrust(alive));
  const orcaWVigorValues = bySpecies.orca
    .map((o) => o.weights.hunt_attractiveness?.w_vigor)
    .filter((v): v is number => v !== undefined);
  orcaWVigorAvg.set(meanStddev(orcaWVigorValues).mean);

  const totalEpisodes = sim.acc.totalEpisodesCreated;
  transmissionDepth2PlusRatio.set(totalEpisodes > 0 ? sim.acc.transmissionDepth2Plus / totalEpisodes : 0);

  guardEpisodes.set(sim.acc.guardEpisodes);
  provisionEpisodes.set(sim.acc.provisionEpisodes);
  coordinatedHunts.set(sim.acc.coordinatedHunts);
}

/** Экспортирован для тестов (services/sim-engine/tests/metrics.test.ts) — не используется в проде за пределами этого модуля. */
export { register };

export function startMetricsServer(sim: Simulation): http.Server {
  const port = Number(process.env.METRICS_PORT ?? 9464);
  setPopulationGauges(sim);
  const server = http.createServer((req, res) => {
    if (req.url !== "/metrics") {
      res.writeHead(404);
      res.end();
      return;
    }
    register
      .metrics()
      .then((body) => {
        res.writeHead(200, { "Content-Type": register.contentType });
        res.end(body);
      })
      .catch((err) => {
        res.writeHead(500);
        res.end(String(err));
      });
  });
  server.listen(port, () => console.log(`[sim-engine] метрики Prometheus: http://0.0.0.0:${port}/metrics`));
  return server;
}
