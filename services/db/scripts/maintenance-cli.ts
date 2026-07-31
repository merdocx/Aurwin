import { createPool } from "../src/pool.js";
import { runRetentionMaintenance } from "../src/maintenance/index.js";

/**
 * CLI-обёртка runRetentionMaintenance (ops/README.md, фаза 7 «Эксплуатация»):
 * скрипты обслуживания ретенции уже реализованы (src/maintenance/*.ts), но
 * до этой фазы ничего не вызывало их по расписанию. Запускается ежесуточно
 * cron/systemd timer'ом (ops/systemd/aurwin-retention.timer) вне тикового
 * цикла sim-engine — то же разделение "обслуживание не блокирует
 * симуляцию", что и для LLM-вызовов (7.3).
 */
const pool = createPool();
try {
  const result = await runRetentionMaintenance(pool);
  console.log("[maintenance] готово:", JSON.stringify(result));
} finally {
  await pool.end();
}
