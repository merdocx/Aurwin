// sim-engine — тик-цикл 24/7 (ТЗ А.1, А.3).
// Фаза 5 «Наблюдение»: полноценная Simulation (существа + utility AI, фаза 4)
// тикает и пишет состояние в Postgres — persistSnapshot (шаг 14) и
// broadcastDelta (шаг 13) из А.3 больше не заглушки (см. ops/DEVIATIONS.md,
// фаза 5, где обосновано разделение "лёгкой" записи каждый тик и "полного"
// снапшота раз в time.snapshot_interval_ticks, и канал LISTEN/NOTIFY
// вместо прямого соединения с api-gateway).
//
// Симуляция никогда не блокируется на LLM-вызове (7.3) — этот процесс не
// импортирует и не вызывает reflection-worker напрямую (рефлексия замокана,
// generateMockReflection — CLAUDE.md, п.7); ошибки записи в БД логируются и
// НЕ останавливают тик-цикл (мир не должен замирать из-за сетевого сбоя).

import { Simulation } from "./sim/simulation.js";
import { seedGenesisNarratives } from "./sim/genesisNarrative.js";
import { getSimConstants } from "./sim/simConstants.js";
import { isAlive, type WorldEvent } from "./sim/types.js";
import { createPool } from "./persistence/pool.js";
import {
  applyDeaths,
  insertDecisionLogs,
  insertEpisodes,
  insertSignals,
  insertWorldEvents,
  notifyTick,
  persistGenesis,
  syncAversions,
  syncBonds,
  syncPerceivedStates,
  syncPerceivedZoneThreat,
  syncSignalTrust,
  updateSignalOutcomes,
  updateWorldClock,
  upsertCreatures,
  type DeathRecord,
} from "./persistence/persist.js";
import { reflectionSyncWatermark, reloadReflectionFields } from "./persistence/reloadReflection.js";
import { hasAnyCreatureRecord, loadWorldState } from "./persistence/restore.js";
import { recordWorldEvent, setPopulationGauges, startMetricsServer } from "./metrics.js";

console.log("[sim-engine] запуск тик-цикла мира (фаза 7 «Эксплуатация»)");

const pool = createPool();
const { visual_tick_seconds, snapshot_interval_ticks } = getSimConstants().time;

const seed = Number(process.env.AURWIN_SEED ?? Date.now() % 1_000_000);
let pendingEvents: WorldEvent[] = [];
let pendingDeaths: DeathRecord[] = [];

// Восстановление после рестарта (А.7): если world_clock уже содержит тик из
// предыдущего запуска — мир продолжается с него (genesis НЕ повторяется).
// "Время после паузы НЕ догоняется" — tick_ просто резюмируется с того же
// значения, без попытки наверстать пропущенный интервал реального времени.
const restored = await loadWorldState(pool);

if (!restored && (await hasAnyCreatureRecord(pool))) {
  // Защита от повторного genesis (см. persistence/restore.ts::hasAnyCreatureRecord
  // и persistence/persist.ts::persistGenesis): world_clock пуст, но creatures
  // уже содержит записи — это НЕ штатный холодный старт. Запуск genesis здесь
  // повторил бы дефект приёмки (40->80 пингвинов, 4->8 касаток). Мир не
  // перезапускается и история не стирается (7.4 ТЗ) — вместо тихого действия
  // процесс останавливается и требует ручного разбора (ops/DEVIATIONS.md).
  console.error(
    "[sim-engine] КРИТИЧНО: world_clock пуст, но creatures уже содержит записи — отказ от повторного genesis. " +
      "Разберитесь вручную (см. ops/DEVIATIONS.md, фаза 7) и не удаляйте существующие данные без явного решения.",
  );
  await pool.end();
  process.exit(1);
}

const sim = new Simulation(
  seed,
  {
    onWorldEvent: (event) => {
      pendingEvents.push(event);
      recordWorldEvent(event, sim.world.dayNight.phase());
      if (event.type === "death" && event.actorId) {
        const cause = (event.payload as { cause?: DeathRecord["cause"] }).cause;
        if (cause) pendingDeaths.push({ id: event.actorId, cause, tick: event.tick });
      }
    },
    // Фаза 6: reflection-worker — отдельный процесс, реально вызывающий
    // Anthropic API и пишущий traits/weights/narrative/intentions прямо в
    // Postgres (services/reflection-worker/src/apply.ts). Заглушка
    // generateMockReflection здесь ВЫКЛЮЧЕНА, иначе её тиковый пересчёт
    // периодически затирал бы в памяти то, что применил reflection-worker
    // (см. комментарий SimulationHooks.mockReflectionEnabled, sim/simulation.ts).
    mockReflectionEnabled: false,
  },
  restored ?? undefined,
);

if (restored) {
  console.log(`[sim-engine] мир восстановлен из снапшота: тик ${restored.tick}, ${restored.creatures.length} живых существ`);
} else {
  console.log(`[sim-engine] мир не найден в БД — genesis-запуск`);
  await seedGenesisNarratives(sim.aliveCreatures());
  // Атомарная запись genesis-популяции + world_clock ОДНОЙ транзакцией (см.
  // persistGenesis) — устраняет само окно, в котором creatures успевают
  // попасть в БД без world_clock при крахе процесса между двумя раздельными
  // await (ровно причина дефекта двойного genesis при приёмке).
  await persistGenesis(pool, sim.aliveCreatures(), sim.currentTick, sim.world.dayNight.phase(), sim.fishDensitySnapshot());
  console.log(`[sim-engine] genesis записан атомарно: тик ${sim.currentTick}, ${sim.aliveCreatures().length} существ`);
}

startMetricsServer(sim);

let lastPhase = sim.world.dayNight.phase();
let stopped = false;
let lastReflectionSyncAt = reflectionSyncWatermark(sim.aliveCreatures());

async function persistTick(): Promise<void> {
  const events = pendingEvents;
  const deaths = pendingDeaths;
  const episodes = sim.drainNewEpisodes();
  const newSignals = sim.drainNewSignals();
  const resolvedSignals = sim.drainResolvedSignals();
  const decisionLogs = sim.drainDecisionLogs();
  pendingEvents = [];
  pendingDeaths = [];

  const alive = sim.aliveCreatures();
  const phase = sim.world.dayNight.phase();
  const isFullSnapshot = sim.currentTick % snapshot_interval_ticks === 0;
  // Light UPDATE не INSERT'ит новых строк — full нужен на birth и reintroduction.
  const needsInsert = events.some((e) => e.type === "birth" || e.type === "reintroduction");

  try {
    await upsertCreatures(pool, alive, isFullSnapshot || needsInsert ? "full" : "light");
    if (deaths.length > 0) await applyDeaths(pool, deaths);
    if (events.length > 0) await insertWorldEvents(pool, events);
    if (episodes.length > 0) await insertEpisodes(pool, episodes);
    if (newSignals.length > 0) await insertSignals(pool, newSignals);
    if (resolvedSignals.length > 0) await updateSignalOutcomes(pool, resolvedSignals);
    if (decisionLogs.length > 0) await insertDecisionLogs(pool, decisionLogs);
    if (isFullSnapshot) {
      await syncBonds(pool, [...sim.bonds.values()]);
      await syncAversions(pool, [...sim.aversions.values()]);
      await syncPerceivedStates(pool, alive);
      await syncPerceivedZoneThreat(pool, alive);
      await syncSignalTrust(pool, alive);
    }
    await updateWorldClock(pool, sim.currentTick, phase, sim.fishDensitySnapshot());
    await notifyTick(pool, sim.currentTick, phase);
    setPopulationGauges(sim);
  } catch (err) {
    // Вернуть буферы в очередь — иначе mid-persist fail безвозвратно теряет тик.
    pendingEvents = [...events, ...pendingEvents];
    pendingDeaths = [...deaths, ...pendingDeaths];
    sim.requeueEpisodes(episodes);
    sim.requeueNewSignals(newSignals);
    sim.requeueResolvedSignals(resolvedSignals);
    sim.requeueDecisionLogs(decisionLogs);
    throw err;
  }
}

async function loop(): Promise<void> {
  if (stopped) return;
  const start = Date.now();
  try {
    if (sim.currentTick % snapshot_interval_ticks === 0) {
      lastReflectionSyncAt = await reloadReflectionFields(pool, sim.creatures, lastReflectionSyncAt);
    }
    sim.tick();
    const phase = sim.world.dayNight.phase();
    if (phase !== lastPhase) {
      console.log(`[sim-engine] смена суток: ${lastPhase} -> ${phase} (тик ${sim.currentTick})`);
      lastPhase = phase;
    }
    await persistTick();
  } catch (err) {
    // Сбой записи в БД (сеть/рестарт Postgres) не должен останавливать
    // тик-цикл — мир должен продолжать жить даже если наблюдатели временно
    // ничего не увидят (6.1: сервер тикает независимо от подключений).
    console.error("[sim-engine] ошибка в тике/персистентности:", err);
  }
  const elapsed = Date.now() - start;
  const delay = Math.max(0, visual_tick_seconds * 1000 - elapsed);
  if (!stopped) setTimeout(loop, delay);
}

console.log(`[sim-engine] текущая популяция: ${sim.aliveCreatures().length} существ, seed=${seed}`);
loop();

process.on("SIGTERM", () => {
  console.log("[sim-engine] получен SIGTERM, завершение");
  stopped = true;
  pool.end().finally(() => process.exit(0));
});
