import { getSimConstants } from "./simConstants.js";
import type { Creature, Intention } from "./types.js";

const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_OUTPUT_TOKENS = 4096;
const GENESIS_LLM_TIMEOUT_MS = Number(process.env.GENESIS_LLM_TIMEOUT_MS ?? 15_000);

interface MessageCallResult {
  text: string;
}

export interface GenesisNarrativeTransport {
  createMessage(model: string, userContent: string): Promise<MessageCallResult>;
}

interface GenesisSeedResponse {
  creatures: Array<{
    id: string;
    narrative: string;
    narrative_facts: string[];
    intentions?: Intention[];
  }>;
}

function apiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY;
}

function systemPrompt(): string {
  return [
    "Ты генерируешь стартовый self-narrative для genesis-существ мира Aurwin.",
    "Верни СТРОГО JSON без markdown и лишнего текста.",
    "Для КАЖДОГО существа создай короткое спокойное самоописание от первого лица на русском языке.",
    "Это СТАРТ жизни: существо молодо, ещё мало что пережило, но уже имеет темперамент.",
    "Не придумывай событий, которых не было. Никаких друзей, охот, смертей, потомства, конфликтов или конкретных мест из прошлого.",
    "Разрешено опираться только на вид, пол, черты характера и хронотип как на врождённые склонности.",
    "Поле narrative_facts: 1-3 коротких факта для карточки существа.",
    "Поле intentions: 0-2 кратких намерения из допустимых простых эффектов: {} | {\"prefer_zone\": <zone>} | {\"avoid_zone\": <zone>} | {\"seek_mate\": true}.",
    "Не используй approach_bonus, avoid_creature, hunt_with, zone_penalty, zone_bonus.",
    "Формат ответа: {\"creatures\":[{\"id\":string,\"narrative\":string,\"narrative_facts\":string[],\"intentions\":Intention[]}]}.",
  ].join("\n");
}

export class HttpGenesisNarrativeTransport implements GenesisNarrativeTransport {
  async createMessage(model: string, userContent: string): Promise<MessageCallResult> {
    const key = apiKey();
    if (!key) throw new Error("ANTHROPIC_API_KEY не задан");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GENESIS_LLM_TIMEOUT_MS);
    const response = await fetch(`${ANTHROPIC_API_BASE}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: systemPrompt(),
        messages: [{ role: "user", content: userContent }],
      }),
    }).finally(() => clearTimeout(timeout));
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Anthropic Messages API: ${response.status} ${body.slice(0, 500)}`);
    }
    const json = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
    };
    return { text: json.content.find((block) => block.type === "text")?.text ?? "" };
  }
}

function stripMarkdownFence(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function isAllowedGenesisIntention(intentions: unknown): intentions is Intention[] {
  if (!Array.isArray(intentions)) return false;
  return intentions.every((item) => {
    if (!item || typeof item !== "object") return false;
    const record = item as Record<string, unknown>;
    if (typeof record.text !== "string") return false;
    const effect = record.effect;
    if (!effect || typeof effect !== "object" || Array.isArray(effect)) return false;
    const keys = Object.keys(effect as Record<string, unknown>);
    return keys.every((key) => key === "prefer_zone" || key === "avoid_zone" || key === "seek_mate");
  });
}

function parseSeeds(raw: string, knownIds: Set<string>): Map<string, { narrative: string; facts: string[]; intentions: Intention[] }> {
  const cleaned = stripMarkdownFence(raw);
  const parsed = JSON.parse(cleaned) as GenesisSeedResponse;
  const out = new Map<string, { narrative: string; facts: string[]; intentions: Intention[] }>();
  if (!parsed || !Array.isArray(parsed.creatures)) return out;
  for (const item of parsed.creatures) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.id !== "string" || !knownIds.has(item.id)) continue;
    if (typeof item.narrative !== "string" || !Array.isArray(item.narrative_facts)) continue;
    const facts = item.narrative_facts.filter((fact): fact is string => typeof fact === "string").slice(0, 5);
    const intentions = isAllowedGenesisIntention(item.intentions ?? []) ? (item.intentions ?? []) : [];
    out.set(item.id, {
      narrative: item.narrative.trim(),
      facts,
      intentions,
    });
  }
  return out;
}

export async function seedGenesisNarratives(
  creatures: Creature[],
  transport: GenesisNarrativeTransport = new HttpGenesisNarrativeTransport(),
): Promise<void> {
  if (creatures.length === 0) return;
  if (!apiKey()) return;

  const payload = {
    creatures: creatures.map((creature) => ({
      id: creature.id,
      species: creature.species,
      name: creature.name,
      sex: creature.sex,
      traits: creature.traits,
      chronotype: creature.chronotype,
      zones: Object.keys(getSimConstants().world.zones),
    })),
  };

  try {
    const model = getSimConstants().reflection.models.background;
    const result = await transport.createMessage(model, JSON.stringify(payload));
    const seeds = parseSeeds(result.text, new Set(creatures.map((creature) => creature.id)));
    for (const creature of creatures) {
      const seed = seeds.get(creature.id);
      if (!seed) continue;
      if (seed.narrative.length > 0) creature.narrative = seed.narrative;
      if (seed.facts.length > 0) creature.narrativeFacts = seed.facts;
      creature.intentions = seed.intentions;
    }
  } catch (err) {
    console.warn("[sim-engine] genesis LLM-narrative недоступен, используется стартовый fallback:", err);
  }
}
