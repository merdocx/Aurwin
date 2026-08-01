export interface CreatureCard {
  id: string;
  species: "penguin" | "orca";
  name: string;
  sex: "m" | "f";
  age_weeks: number;
  alive: boolean;
  death_cause: string | null;
  traits: Record<string, number>;
  needs: Record<string, number>;
  emotion: { valence: number; arousal: number };
  is_asleep: boolean;
  leading_skills: Array<{ skill: string; value: number }>;
  narrative_facts: string[];
  intentions: Array<{ text: string; effect?: Record<string, unknown> }>;
  habits: Record<string, number>;
  timeline: Array<{
    id: string;
    tick: number;
    type: string;
    actor_id: string | null;
    target_id: string | null;
    zone: string | null;
    payload: Record<string, unknown>;
  }>;
}

export interface SocialGraph {
  nodes: Array<{ id: string; species: "penguin" | "orca"; name: string }>;
  edges: Array<{ a: string; b: string; strength: number; kind: "friend" | "mate" | "kin" }>;
}

export interface WorldStats {
  tick: number;
  phase: "day" | "night";
  population: Record<string, number>;
  generation: number;
}

function apiBase(): string {
  const explicit = import.meta.env.VITE_API_URL as string | undefined;
  if (explicit) return explicit;
  if (window.location.port === "5173" || window.location.hostname === "localhost") {
    return `${window.location.protocol}//${window.location.hostname}:3000`;
  }
  return "";
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function fetchCreatureCard(id: string): Promise<CreatureCard> {
  return getJson(`/api/creatures/${encodeURIComponent(id)}`);
}

export function fetchSocialGraph(): Promise<SocialGraph> {
  return getJson(`/api/social-graph`);
}

export function fetchWorldStats(): Promise<WorldStats> {
  return getJson(`/api/world/stats`);
}
