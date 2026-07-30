// sim-engine — тик-цикл 24/7 (ТЗ А.1, А.3).
// Фаза 3 «Мир»: карта/зоны/рыба/сутки (services/world) тикают по-настоящему.
// Существа, utility AI и запись состояния в БД — фаза 4+.
// Симуляция никогда не блокируется на LLM-вызове (7.3) — этот процесс не
// импортирует и не вызывает reflection-worker напрямую, только читает
// результаты рефлексии из БД (см. А.1: "sim-engine — единственный писатель
// игрового состояния").

import { getWorldConstants, World } from "./world/index.js";

console.log("[sim-engine] запуск тик-цикла мира (фаза 3 «Мир»)");

const world = new World();
const { visual_tick_seconds } = getWorldConstants().time;
let lastPhase = world.dayNight.phase();

const timer = setInterval(() => {
  world.tick();
  const phase = world.dayNight.phase();
  if (phase !== lastPhase) {
    console.log(`[sim-engine] смена суток: ${lastPhase} -> ${phase} (тик ${world.dayNight.currentTick})`);
    lastPhase = phase;
  }
}, visual_tick_seconds * 1000);

process.on("SIGTERM", () => {
  console.log("[sim-engine] получен SIGTERM, завершение");
  clearInterval(timer);
  process.exit(0);
});
