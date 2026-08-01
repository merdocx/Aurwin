#!/usr/bin/env node
/**
 * Короткий outlier-отчёт по обучению: дрейф черт от birth, навыки у потолка,
 * частые kind в learning_events.
 *
 * Источник (по приоритету):
 *   1) аргумент — путь к каталогу экспорта (*.ndjson)
 *   2) AURWIN_LEARNING_EXPORT_DIR / /var/lib/aurwin/exports/learning — latest
 *   3) DATABASE_URL или PG* — прямой SELECT из Postgres (нужен пакет pg)
 *
 * Запуск: node ops/learning/analyze_patterns.mjs [exportDir]
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SKILL_CAP = 0.9;
const TRAIT_OUTLIER = 0.4;

function readNdjson(file) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8").trim();
  if (!text) return [];
  return text.split("\n").map((line) => JSON.parse(line));
}

function latestExportDir(root) {
  if (!fs.existsSync(root)) return null;
  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  if (dirs.length === 0) return null;
  return path.join(root, dirs[dirs.length - 1]);
}

async function loadPgPool() {
  try {
    const { Pool } = await import("pg");
    return Pool;
  } catch {
    const candidates = [
      path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../node_modules/pg/lib/index.js"),
      path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../services/db/node_modules/pg/lib/index.js"),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        const mod = await import(pathToFileURL(candidate).href);
        return mod.Pool ?? mod.default?.Pool ?? mod.default;
      }
    }
    throw new Error("Пакет pg не найден. Экспортируйте NDJSON (export_learning.sh) или установите зависимости.");
  }
}

async function loadFromDb() {
  const Pool = await loadPgPool();
  const pool = new Pool(
    process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL }
      : {
          host: process.env.PGHOST ?? "127.0.0.1",
          port: Number(process.env.PGPORT ?? 5432),
          user: process.env.PGUSER ?? "aurwin",
          password: process.env.PGPASSWORD,
          database: process.env.PGDATABASE ?? "aurwin",
        },
  );
  try {
    const [traitsBirth, traitsNow, skills, learning] = await Promise.all([
      pool.query(`SELECT creature_id, traits FROM trait_history WHERE source = 'birth'`),
      pool.query(
        `SELECT DISTINCT ON (creature_id) creature_id, traits, tick
         FROM trait_history WHERE source = 'reflection'
         ORDER BY creature_id, tick DESC`,
      ),
      pool.query(`SELECT id, name, skills FROM creatures WHERE died_at_tick IS NULL`),
      pool.query(`SELECT kind, count(*)::int AS n FROM learning_events GROUP BY kind ORDER BY n DESC`),
    ]);
    return {
      birth: traitsBirth.rows,
      latestReflection: traitsNow.rows,
      creatures: skills.rows,
      learningCounts: learning.rows,
      source: "database",
    };
  } finally {
    await pool.end();
  }
}

function loadFromExport(dir) {
  const birth = readNdjson(path.join(dir, "trait_history.ndjson")).filter((r) => r.source === "birth");
  const reflections = readNdjson(path.join(dir, "trait_history.ndjson")).filter((r) => r.source === "reflection");
  const latestByCreature = new Map();
  for (const row of reflections) {
    const prev = latestByCreature.get(row.creature_id);
    if (!prev || Number(row.tick) > Number(prev.tick)) latestByCreature.set(row.creature_id, row);
  }
  const learning = readNdjson(path.join(dir, "learning_events.ndjson"));
  const learningCountsMap = new Map();
  for (const ev of learning) {
    learningCountsMap.set(ev.kind, (learningCountsMap.get(ev.kind) ?? 0) + 1);
  }
  return {
    birth,
    latestReflection: [...latestByCreature.values()],
    creatures: [],
    learningCounts: [...learningCountsMap.entries()].map(([kind, n]) => ({ kind, n })).sort((a, b) => b.n - a.n),
    source: dir,
  };
}

function traitDriftReport(birthRows, reflectionRows) {
  const birthMap = new Map(birthRows.map((r) => [r.creature_id, r.traits]));
  const outliers = [];
  for (const row of reflectionRows) {
    const birth = birthMap.get(row.creature_id);
    if (!birth || !row.traits) continue;
    for (const [key, value] of Object.entries(row.traits)) {
      const b = birth[key];
      if (typeof b !== "number" || typeof value !== "number") continue;
      const delta = value - b;
      if (Math.abs(delta) >= TRAIT_OUTLIER) {
        outliers.push({ creature_id: row.creature_id, trait: key, birth: b, now: value, delta });
      }
    }
  }
  outliers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return outliers.slice(0, 20);
}

function skillCeilingReport(creatures) {
  const hits = [];
  for (const c of creatures) {
    const skills = c.skills ?? {};
    for (const [skill, value] of Object.entries(skills)) {
      if (typeof value === "number" && value >= SKILL_CAP - 1e-9) {
        hits.push({ id: c.id, name: c.name, skill, value });
      }
    }
  }
  return hits.slice(0, 20);
}

async function main() {
  const argDir = process.argv[2];
  const exportRoot = process.env.AURWIN_LEARNING_EXPORT_DIR ?? "/var/lib/aurwin/exports/learning";
  let data;

  if (argDir) {
    data = loadFromExport(argDir);
  } else {
    const latest = latestExportDir(exportRoot);
    if (latest) {
      data = loadFromExport(latest);
    } else if (process.env.DATABASE_URL || process.env.PGHOST || process.env.PGPASSWORD) {
      data = await loadFromDb();
    } else {
      const local = latestExportDir(path.resolve("ops/learning/exports"));
      if (local) data = loadFromExport(local);
      else {
        console.error("Нет экспорта и нет DATABASE_URL/PG*. Сначала: ops/learning/export_learning.sh");
        process.exit(1);
      }
    }
  }

  const drifts = traitDriftReport(data.birth, data.latestReflection);
  const ceilings = skillCeilingReport(data.creatures);

  console.log(`# Aurwin learning patterns (${data.source})`);
  console.log(`birth rows: ${data.birth.length}, latest reflection snapshots: ${data.latestReflection.length}`);
  console.log("");
  console.log("## Trait drift vs birth (|Δ| ≥ 0.4)");
  if (drifts.length === 0) console.log("(нет)");
  else for (const d of drifts) {
    console.log(`  ${d.creature_id.slice(0, 8)}…  ${d.trait}: birth=${d.birth.toFixed(3)} now=${d.now.toFixed(3)} Δ=${d.delta.toFixed(3)}`);
  }
  console.log("");
  console.log("## Skills at ceiling (≥ 0.9)");
  if (data.creatures.length === 0) console.log("(skills только из БД — в NDJSON-экспорте нет creatures)");
  else if (ceilings.length === 0) console.log("(нет)");
  else for (const s of ceilings) {
    console.log(`  ${s.name ?? s.id.slice(0, 8)}  ${s.skill}=${s.value}`);
  }
  console.log("");
  console.log("## learning_events by kind");
  if (data.learningCounts.length === 0) console.log("(пусто)");
  else for (const row of data.learningCounts) {
    console.log(`  ${row.kind}: ${row.n}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
