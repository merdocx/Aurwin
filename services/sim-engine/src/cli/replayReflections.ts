import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReflectionResult } from "../sim/reflection.js";
import type { Creature, Intention, Species, Traits } from "../sim/types.js";

interface ReplayReflectionSample {
  species?: Species;
  narrative?: string;
  narrativeFacts?: string[];
  traitDeltas?: Partial<Traits>;
  weightDeltas?: Record<string, number>;
  intentions?: Intention[];
}

function normalizeSample(input: unknown): ReplayReflectionSample | undefined {
  if (!input || typeof input !== "object") return undefined;
  const row = input as Record<string, unknown>;
  const intentions = Array.isArray(row.intentions) ? (row.intentions as Intention[]) : [];
  const narrativeFacts = Array.isArray(row.narrativeFacts)
    ? row.narrativeFacts.filter((v): v is string => typeof v === "string")
    : Array.isArray(row.narrative_facts)
      ? (row.narrative_facts as unknown[]).filter((v): v is string => typeof v === "string")
      : [];
  return {
    species: row.species === "penguin" || row.species === "orca" ? row.species : undefined,
    narrative: typeof row.narrative === "string" ? row.narrative : undefined,
    narrativeFacts,
    traitDeltas:
      row.traitDeltas && typeof row.traitDeltas === "object"
        ? (row.traitDeltas as Partial<Traits>)
        : row.trait_deltas && typeof row.trait_deltas === "object"
          ? (row.trait_deltas as Partial<Traits>)
          : {},
    weightDeltas:
      row.weightDeltas && typeof row.weightDeltas === "object"
        ? (row.weightDeltas as Record<string, number>)
        : row.weight_deltas && typeof row.weight_deltas === "object"
          ? (row.weight_deltas as Record<string, number>)
          : {},
    intentions,
  };
}

export function loadReplayReflectionLibrary(filePath: string): ReplayReflectionSample[] {
  const absolute = path.resolve(filePath);
  const raw = readFileSync(absolute, "utf8").trim();
  if (!raw) return [];

  const direct = JSON.parse(raw) as unknown;
  const rows = Array.isArray(direct)
    ? direct
    : direct && typeof direct === "object" && Array.isArray((direct as { samples?: unknown[] }).samples)
      ? (direct as { samples: unknown[] }).samples
      : direct && typeof direct === "object" && Array.isArray((direct as { reflections?: unknown[] }).reflections)
        ? (direct as { reflections: unknown[] }).reflections
        : [];
  return rows.map(normalizeSample).filter((sample): sample is ReplayReflectionSample => sample !== undefined);
}

export function createReplayReflectionGenerator(samples: ReplayReflectionSample[]): (creature: Creature) => ReflectionResult {
  const perSpecies = new Map<Species, ReplayReflectionSample[]>();
  for (const species of ["penguin", "orca"] as const) {
    perSpecies.set(species, samples.filter((sample) => sample.species === undefined || sample.species === species));
  }
  const counters = new Map<string, number>();

  return (creature: Creature): ReflectionResult => {
    const pool = perSpecies.get(creature.species) ?? [];
    if (pool.length === 0) {
      return {
        narrative: creature.narrativeFacts.join(" ") || "Я продолжаю жить своей жизнью.",
        narrativeFacts: creature.narrativeFacts,
        traitDeltas: {},
        weightDeltas: {},
        intentions: creature.intentions,
      };
    }
    const index = counters.get(creature.id) ?? 0;
    counters.set(creature.id, index + 1);
    const sample = pool[index % pool.length]!;
    return {
      narrative: sample.narrative ?? creature.narrative ?? "Я продолжаю жить своей жизнью.",
      narrativeFacts: sample.narrativeFacts && sample.narrativeFacts.length > 0 ? sample.narrativeFacts : creature.narrativeFacts,
      traitDeltas: sample.traitDeltas ?? {},
      weightDeltas: sample.weightDeltas ?? {},
      intentions: sample.intentions ?? [],
    };
  };
}
