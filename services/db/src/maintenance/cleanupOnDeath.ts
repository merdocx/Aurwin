import type { Pool } from "pg";

export interface CleanupOnDeathResult {
  perceivedStates: number;
  perceivedZoneThreat: number;
  signalTrust: number;
}

/**
 * perceived_states / perceived_zone_threat / signal_trust — транзиентные:
 * удаляются при смерти любой из сторон (репутация и восприятие не переживают
 * носителя). Сходимость с истинной оценкой без смерти — забота тик-пайплайна
 * (decayPerceivedStates, А.3), не этой функции. ТЗ А.2.
 */
export async function cleanupOnDeath(pool: Pool): Promise<CleanupOnDeathResult> {
  const perceivedStates = await pool.query(`
    DELETE FROM perceived_states
    WHERE observer_id IN (SELECT id FROM creatures WHERE died_at_tick IS NOT NULL)
       OR subject_id IN (SELECT id FROM creatures WHERE died_at_tick IS NOT NULL)
  `);

  const perceivedZoneThreat = await pool.query(`
    DELETE FROM perceived_zone_threat
    WHERE observer_id IN (SELECT id FROM creatures WHERE died_at_tick IS NOT NULL)
  `);

  const signalTrust = await pool.query(`
    DELETE FROM signal_trust
    WHERE observer_id IN (SELECT id FROM creatures WHERE died_at_tick IS NOT NULL)
       OR signaler_id IN (SELECT id FROM creatures WHERE died_at_tick IS NOT NULL)
  `);

  return {
    perceivedStates: perceivedStates.rowCount ?? 0,
    perceivedZoneThreat: perceivedZoneThreat.rowCount ?? 0,
    signalTrust: signalTrust.rowCount ?? 0,
  };
}
