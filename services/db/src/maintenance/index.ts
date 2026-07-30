import type { Pool } from "pg";
import { pruneEpisodes } from "./pruneEpisodes.js";
import { cleanupDecisionLog } from "./cleanupDecisionLog.js";
import { redactReflections } from "./redactReflections.js";
import { thinTraitHistory } from "./thinTraitHistory.js";
import { rollupWorldEvents } from "./rollupWorldEvents.js";
import { rollupSignals } from "./rollupSignals.js";
import { cleanupOnDeath } from "./cleanupOnDeath.js";

export { pruneEpisodes } from "./pruneEpisodes.js";
export { cleanupDecisionLog } from "./cleanupDecisionLog.js";
export { redactReflections } from "./redactReflections.js";
export { thinTraitHistory } from "./thinTraitHistory.js";
export { rollupWorldEvents } from "./rollupWorldEvents.js";
export { rollupSignals } from "./rollupSignals.js";
export { cleanupOnDeath } from "./cleanupOnDeath.js";

/**
 * Прогон всех скриптов обслуживания политики ретенции (А.2). Предназначен
 * для периодического запуска (напр. ежесуточный cron), не для тик-пайплайна
 * sim-engine (7.3: симуляция не блокируется на обслуживании БД так же, как
 * не блокируется на LLM-вызове).
 */
export async function runRetentionMaintenance(pool: Pool) {
  return {
    episodes: await pruneEpisodes(pool),
    decisionLog: await cleanupDecisionLog(pool),
    reflections: await redactReflections(pool),
    traitHistory: await thinTraitHistory(pool),
    worldEvents: await rollupWorldEvents(pool),
    signals: await rollupSignals(pool),
    onDeath: await cleanupOnDeath(pool),
  };
}
