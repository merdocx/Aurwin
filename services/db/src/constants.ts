import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONSTANTS_PATH = path.resolve(__dirname, "../../../config/constants.yaml");

/**
 * Единый источник правды для констант симуляции (CLAUDE.md, «Незыблемые
 * правила», п.3) — скрипты обслуживания не хардкодят пороги ретенции,
 * а читают их отсюда.
 */
export function loadConstants(): Record<string, any> {
  return yaml.load(readFileSync(CONSTANTS_PATH, "utf8")) as Record<string, any>;
}
