// CLI прогона симуляции без реального времени (задача фазы 4, продолжение):
// `npm run simulate -- --days N --fast --seed S`.
//
// Не тикает через setInterval (как src/index.ts, dev-режим) — вызывает
// Simulation.tick() в цикле максимально быстро, копит метрики через хуки
// Simulation (onWorldEvent) и публичные поля (creatures/acc/bonds), печатает
// отчёт по завершении. Ничего не пишет в БД — фаза 4 сознательно чисто
// in-memory (ops/DEVIATIONS.md), это инструмент проверки баланса, не сервис.
import { Simulation, type SimulationHooks } from "../sim/simulation.js";
import { getSimConstants } from "../sim/simConstants.js";
import { realDaysToTicks } from "../sim/time.js";
import { TRAIT_KEYS, SKILL_KEYS, isAlive, type Creature, type Species, type WorldEvent } from "../sim/types.js";
import { trueVigor } from "../sim/vigor.js";

interface Args {
  days: number;
  fast: boolean;
  seed: number;
}

function parseArgs(argv: string[]): Args {
  let days = 30;
  let fast = false;
  let seed = Math.floor(Date.now() % 1_000_000);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--days") days = Number(argv[++i]);
    else if (a === "--fast") fast = true;
    else if (a === "--seed") seed = Number(argv[++i]);
    else throw new Error(`неизвестный аргумент: ${a}`);
  }
  if (!Number.isFinite(days) || days <= 0) throw new Error("--days должен быть положительным числом");
  if (!Number.isFinite(seed)) throw new Error("--seed должен быть числом");
  return { days, fast, seed };
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, v) => s + v, 0) / xs.length;
}

function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length;
}

/** Total variation distance между двумя распределениями действий, 0..1. */
function distributionDistance(a: Record<string, number>, b: Record<string, number>): number {
  const totalA = Object.values(a).reduce((s, v) => s + v, 0);
  const totalB = Object.values(b).reduce((s, v) => s + v, 0);
  if (totalA === 0 || totalB === 0) return 0;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dist = 0;
  for (const k of keys) dist += Math.abs((a[k] ?? 0) / totalA - (b[k] ?? 0) / totalB);
  return dist / 2;
}

function avgPairwiseDivergence(distributions: Record<string, number>[]): number {
  if (distributions.length < 2) return 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < distributions.length; i++) {
    for (let j = i + 1; j < distributions.length; j++) {
      sum += distributionDistance(distributions[i], distributions[j]);
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

function subtractCounts(current: Record<string, number>, base: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(current)) out[k] = v - (base[k] ?? 0);
  return out;
}

function fmt(n: number, digits = 3): string {
  return n.toFixed(digits);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.fast) {
    console.error(
      "[simulate] предупреждение: без --fast каждый тик ждёт time.visual_tick_seconds реального времени — " +
        `для --days ${args.days} это будет очень долго. Используйте --fast для прогона без задержек.`,
    );
  }
  console.error(`[simulate] старт: days=${args.days} seed=${args.seed} fast=${args.fast}`);

  // ---- сбор метрик, накапливаемых через хуки/снимки (не трогая sim/*.ts) ----
  const traitsAtGenesis: Record<Species, Record<string, number[]>> = { penguin: {}, orca: {} };
  for (const species of ["penguin", "orca"] as const) for (const key of TRAIT_KEYS) traitsAtGenesis[species][key] = [];

  // Снимок actionCounts особи в момент взросления (matured) — нужен для
  // поведенческой дивергенции когорты "детство vs зрелость" (цель 7, 7.7).
  const juvenileActionSnapshot = new Map<string, Record<string, number>>();

  // Выборки для сигнальной статистики: на каждой попытке охоты — насколько
  // воспринимаемая касаткой бодрость жертвы отличается от истинной, и было
  // ли расхождение вызвано недавним display_vigor (7.8.3/7.8.4/цель 8).
  const RECENT_SIGNAL_WINDOW_TICKS = 300; // ~10 мин визуального тика — окно "сигнал ещё влияет" (перцептивное смещение затухает 5%/тик, но касатке нужно время дойти до контактного радиуса после сигнала жертвы)
  const huntTargetSamples: { shift: number; wVigor: number; recentSignal: boolean }[] = [];

  let nightTicks = 0;
  let maxAsleepFractionNight = 0;
  let sumAsleepFractionNight = 0;
  let maxAsleepFractionOverall = 0;

  let minPenguins = Infinity;
  let minOrcas = Infinity;
  let alertBreaches = 0;

  let sim!: Simulation;
  const hooks: SimulationHooks = {
    onWorldEvent(event: WorldEvent) {
      if (event.type === "matured" && event.actorId) {
        const c = sim.creatures.get(event.actorId);
        if (c) juvenileActionSnapshot.set(c.id, { ...c.actionCounts });
      }
      if (event.type === "hunt_attempt" && event.actorId && event.targetId) {
        const orca = sim.creatures.get(event.actorId);
        const prey = sim.creatures.get(event.targetId);
        if (orca && prey) {
          const state = orca.perceivedStates.get(prey.id);
          if (state) {
            const trueV = trueVigor(prey, prey.ageStage);
            const w = orca.weights.hunt_attractiveness ?? getSimConstants().hunting.attractiveness_weight_defaults;
            const recentSignal = sim.currentTick - state.lastSignalTick <= RECENT_SIGNAL_WINDOW_TICKS;
            huntTargetSamples.push({ shift: state.perceivedVigor - trueV, wVigor: w.w_vigor, recentSignal });
          }
        }
      }
    },
  };

  sim = new Simulation(args.seed, hooks);
  for (const c of sim.creatures.values()) {
    for (const key of TRAIT_KEYS) traitsAtGenesis[c.species][key].push(c.traits[key]);
  }
  const varianceGenesis: Record<Species, Record<string, number>> = { penguin: {}, orca: {} };
  for (const species of ["penguin", "orca"] as const) {
    for (const key of TRAIT_KEYS) varianceGenesis[species][key] = variance(traitsAtGenesis[species][key]);
  }

  const constants = getSimConstants();
  const totalTicks = Math.max(1, Math.round(realDaysToTicks(args.days)));
  const tickMs = args.fast ? 0 : constants.time.visual_tick_seconds * 1000;
  const startedAt = Date.now();
  let lastProgressPct = -1;

  function runTick(): void {
    sim.tick();

    const alive = [...sim.creatures.values()];
    let penguins = 0;
    let orcas = 0;
    let penguinsAsleep = 0;
    let orcasAsleep = 0;
    for (const c of alive) {
      if (c.species === "penguin") {
        penguins++;
        if (c.isAsleep) penguinsAsleep++;
      } else {
        orcas++;
        if (c.isAsleep) orcasAsleep++;
      }
    }
    minPenguins = Math.min(minPenguins, penguins);
    minOrcas = Math.min(minOrcas, orcas);
    if (
      penguins < constants.population.alert_thresholds.penguins.min ||
      penguins > constants.population.alert_thresholds.penguins.max ||
      orcas < constants.population.alert_thresholds.orcas.min ||
      orcas > constants.population.alert_thresholds.orcas.max
    ) {
      alertBreaches++;
    }

    const totalAsleepFraction = alive.length > 0 ? (penguinsAsleep + orcasAsleep) / alive.length : 0;
    maxAsleepFractionOverall = Math.max(maxAsleepFractionOverall, totalAsleepFraction);
    if (sim.world.dayNight.phase() === "night") {
      nightTicks++;
      const nightFraction = penguins > 0 ? penguinsAsleep / penguins : 0;
      maxAsleepFractionNight = Math.max(maxAsleepFractionNight, nightFraction);
      sumAsleepFractionNight += nightFraction;
    }

    const pct = Math.floor((sim.currentTick / totalTicks) * 100);
    if (pct !== lastProgressPct && pct % 5 === 0) {
      lastProgressPct = pct;
      const elapsedS = (Date.now() - startedAt) / 1000;
      console.error(
        `[simulate] ${pct}% (тик ${sim.currentTick}/${totalTicks}) — пингвинов ${penguins}, касаток ${orcas}, ${elapsedS.toFixed(1)}с`,
      );
    }
  }

  if (args.fast) {
    for (let t = 0; t < totalTicks; t++) runTick();
  } else {
    // Реальновременной режим (без --fast) — оставлен для полноты флага, но
    // непригоден для 30-суточных прогонов (см. предупреждение выше).
    const sleepGate = new Int32Array(new SharedArrayBuffer(4));
    for (let t = 0; t < totalTicks; t++) {
      runTick();
      Atomics.wait(sleepGate, 0, 0, tickMs);
    }
  }

  const elapsedTotalS = (Date.now() - startedAt) / 1000;
  console.error(`[simulate] завершено за ${elapsedTotalS.toFixed(1)}с реального времени (${(totalTicks / elapsedTotalS).toFixed(0)} тиков/с)`);

  // ---- отчёт ----
  const aliveEnd = [...sim.creatures.values()].filter(isAlive);
  const penguinsEnd = aliveEnd.filter((c) => c.species === "penguin");
  const orcasEnd = aliveEnd.filter((c) => c.species === "orca");

  console.log("\n=== Aurwin — прогон симуляции (фаза 4) ===");
  console.log(`Параметры: days=${args.days} (тиков=${totalTicks}) seed=${args.seed}`);
  console.log(`Тик визуальный: ${constants.time.visual_tick_seconds}с, ускорение биочасов ×${constants.time.biological_clock_speedup}`);

  console.log("\n--- Популяция ---");
  console.log(`Пингвины: старт ${constants.population.genesis.penguins} -> сейчас ${penguinsEnd.length} (минимум за прогон: ${minPenguins})`);
  console.log(`Касатки:  старт ${constants.population.genesis.orcas} -> сейчас ${orcasEnd.length} (минимум за прогон: ${minOrcas})`);
  console.log(`Рождений: пингвинов ${sim.acc.births.penguin}, касаток ${sim.acc.births.orca}`);
  console.log(`Смертей пингвинов: ${JSON.stringify(sim.acc.deaths.penguin)}`);
  console.log(`Смертей касаток: ${JSON.stringify(sim.acc.deaths.orca)}`);
  console.log(`Тиков с популяцией вне порогов алёрта (population.alert_thresholds): ${alertBreaches} из ${totalTicks} (${fmt((100 * alertBreaches) / totalTicks, 1)}%)`);
  const extinct = penguinsEnd.length === 0 || orcasEnd.length === 0 || minPenguins === 0 || minOrcas === 0;
  console.log(`Вымирание вида за прогон: ${extinct ? "ДА (гейт провален)" : "нет"}`);

  console.log("\n--- Дисперсия черт характера (генезис -> конец прогона) ---");
  for (const species of ["penguin", "orca"] as const) {
    const pool = species === "penguin" ? penguinsEnd : orcasEnd;
    console.log(`  ${species}:`);
    for (const key of TRAIT_KEYS) {
      const values = pool.map((c) => c.traits[key]);
      const v0 = varianceGenesis[species][key];
      const v1 = variance(values);
      const ratio = v0 > 0 ? v1 / v0 : v1 === 0 ? 1 : Infinity;
      const flag = v0 > 0 && ratio < 0.5 ? " <-- упала более чем вдвое!" : "";
      console.log(`    ${key.padEnd(14)} genesis=${fmt(v0)} конец=${fmt(v1)} отношение=${fmt(ratio, 2)}${flag}`);
    }
  }

  console.log("\n--- Поведенческая дивергенция когорт (детство -> зрелость, цель 7) ---");
  const cohorts = new Map<string, Creature[]>();
  for (const c of aliveEnd) {
    if (!juvenileActionSnapshot.has(c.id)) continue; // только особи, реально прошедшие через взросление в этом прогоне
    const list = cohorts.get(c.cohortId) ?? [];
    list.push(c);
    cohorts.set(c.cohortId, list);
  }
  let cohortsChecked = 0;
  let cohortsGrew = 0;
  const childhoodDivs: number[] = [];
  const maturityDivs: number[] = [];
  for (const [cohortId, members] of cohorts) {
    if (members.length < 3) continue;
    const childhoodDists = members.map((c) => juvenileActionSnapshot.get(c.id)!);
    const maturityDists = members.map((c) => subtractCounts(c.actionCounts, juvenileActionSnapshot.get(c.id)!));
    const childhoodDiv = avgPairwiseDivergence(childhoodDists);
    const maturityDiv = avgPairwiseDivergence(maturityDists);
    cohortsChecked++;
    if (maturityDiv > childhoodDiv) cohortsGrew++;
    childhoodDivs.push(childhoodDiv);
    maturityDivs.push(maturityDiv);
    console.log(`  ${cohortId}: n=${members.length} divergence детство=${fmt(childhoodDiv)} зрелость=${fmt(maturityDiv)} ${maturityDiv > childhoodDiv ? "выросла" : "НЕ выросла"}`);
  }
  if (cohortsChecked === 0) {
    console.log("  (недостаточно когорт с >=3 повзрослевшими особями за длину прогона — увеличьте --days)");
  } else {
    console.log(`  Итого: ${cohortsGrew}/${cohortsChecked} когорт показали рост дивергенции; среднее детство=${fmt(mean(childhoodDivs))} среднее зрелость=${fmt(mean(maturityDivs))}`);
  }

  console.log("\n--- Навыки: разброс в популяции взрослых пингвинов (специализация не выродилась) ---");
  const adultPenguins = penguinsEnd.filter((c) => c.ageStage !== "juvenile");
  for (const key of SKILL_KEYS) {
    const values = adultPenguins.map((c) => c.skills[key]);
    const atCap = values.filter((v) => v >= constants.skills.cap - 1e-6).length;
    console.log(`  ${key.padEnd(12)} среднее=${fmt(mean(values))} дисперсия=${fmt(variance(values))} у потолка=${atCap}/${values.length}`);
  }

  console.log("\n--- Сигнальная статистика (7.8) ---");
  console.log(`  Отправлено сигналов: ${JSON.stringify(sim.acc.signalsSent)}`);
  console.log(`  Опровергнуто: ${JSON.stringify(sim.acc.signalsDisconfirmed)}`);
  const signaled = huntTargetSamples.filter((s) => s.recentSignal);
  const unsignaled = huntTargetSamples.filter((s) => !s.recentSignal);
  console.log(`  Попыток охоты всего: ${huntTargetSamples.length}, из них с недавним display_vigor от жертвы: ${signaled.length}`);
  if (signaled.length > 0) {
    const avgShift = mean(signaled.map((s) => s.shift));
    const avgAttractivenessDelta = mean(signaled.map((s) => -s.wVigor * s.shift));
    console.log(`  Среднее смещение воспринимаемой бодрости у сигнализировавших жертв: ${fmt(avgShift)} (>0 = сигнал завысил бодрость)`);
    console.log(`  Средний эффект на attractiveness() (w_vigor * смещение, со знаком минус): ${fmt(avgAttractivenessDelta)} (<0 = жертва стала МЕНЕЕ привлекательной целью — цель 8 достигнута)`);
  }
  if (unsignaled.length > 0) {
    console.log(`  Для сравнения — без недавнего сигнала: среднее смещение ${fmt(mean(unsignaled.map((s) => s.shift)))}`);
  }
  const avgTrust = mean(aliveEnd.flatMap((c) => [...c.trust.values()].map((t) => t.trust)));
  console.log(`  Среднее доверие (signal_trust) по всем известным парам на конец прогона: ${fmt(avgTrust)}`);

  console.log("\n--- Традиции / вертикальная передача знания (7.7, механизм 5) ---");
  const traditionShare = sim.acc.totalEpisodesCreated > 0 ? sim.acc.transmissionDepth2Plus / sim.acc.totalEpisodesCreated : 0;
  console.log(`  Эпизодов создано социальным обучением: ${sim.acc.totalEpisodesCreated}, из них с transmission_depth>=2: ${sim.acc.transmissionDepth2Plus} (${fmt(100 * traditionShare, 1)}%)`);

  console.log("\n--- Родство и кооперация (7.9) ---");
  console.log(`  guard_offspring эпизодов (охраняемый детёныш пережил атаку): ${sim.acc.guardEpisodes}`);
  console.log(`  provision успешных кормлений: ${sim.acc.provisionEpisodes}`);
  console.log(`  coordinate_hunt совместных успешных охот: ${sim.acc.coordinatedHunts}`);

  console.log("\n--- Сон (7.10) ---");
  console.log(`  Ночных тиков: ${nightTicks}/${totalTicks}`);
  console.log(`  Максимальная доля спящих пингвинов ночью за весь прогон: ${fmt(maxAsleepFractionNight)} (гейт: никогда не 1.0)`);
  console.log(`  Средняя доля спящих пингвинов ночью: ${fmt(nightTicks > 0 ? sumAsleepFractionNight / nightTicks : 0)}`);
  console.log(`  Максимальная доля спящих (весь вид, любое время суток): ${fmt(maxAsleepFractionOverall)}`);

  console.log("\n=== Гейт фазы 4 ===");
  const gateAsleep = maxAsleepFractionNight < 1;
  const gateExtinction = !extinct;
  const gateTraitVariance = (["penguin", "orca"] as const).every((species) =>
    TRAIT_KEYS.every((key) => {
      const v0 = varianceGenesis[species][key];
      if (v0 <= 0) return true;
      const pool = species === "penguin" ? penguinsEnd : orcasEnd;
      const v1 = variance(pool.map((c) => c.traits[key]));
      return v1 / v0 >= 0.5;
    }),
  );
  const gateDivergence = cohortsChecked > 0 && cohortsGrew / cohortsChecked >= 0.5;
  const gateSignals = signaled.length > 0;
  console.log(`  Ни один вид не вымер: ${gateExtinction ? "OK" : "FAIL"}`);
  console.log(`  Дисперсия черт не упала более чем вдвое: ${gateTraitVariance ? "OK" : "FAIL"}`);
  console.log(`  Поведенческая дивергенция когорт выросла: ${gateDivergence ? "OK" : cohortsChecked === 0 ? "н/д (нет данных)" : "FAIL"}`);
  console.log(`  Сигналы измеримо влияют на выбор цели: ${gateSignals ? "OK" : "н/д (сигналов при охоте не зафиксировано)"}`);
  console.log(`  Доля спящих ночью никогда не 100%: ${gateAsleep ? "OK" : "FAIL"}`);
}

main();
