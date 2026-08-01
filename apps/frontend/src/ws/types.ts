export type Phase = "day" | "night";
export type Species = "penguin" | "orca";
export type AgeBand = "juvenile" | "adult" | "old";
export type CreatureActivity =
  | "sleep"
  | "walk"
  | "swim"
  | "hunt"
  | "forage"
  | "flee"
  | "transit_in"
  | "transit_out"
  | "idle";

export interface Emotion {
  valence: number; // -1..1
  arousal: number; // 0..1
}

export interface CreatureDto {
  id: string;
  species: Species;
  name: string;
  x: number;
  y: number;
  zone: string;
  emotion: Emotion;
  is_asleep: boolean;
  age_band: AgeBand;
  /** Режим для UI; опционален для старых payload. */
  activity?: CreatureActivity;
}

export interface ZoneDto {
  name: string;
  type: "ice" | "water";
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface WorldEventDto {
  id: string;
  tick: number;
  type: string;
  actor_id: string | null;
  target_id: string | null;
  zone: string | null;
  payload: Record<string, unknown>;
}

export interface SnapshotMessage {
  type: "snapshot";
  tick: number;
  phase: Phase;
  tick_seconds: number;
  creatures: CreatureDto[];
  zones: ZoneDto[];
  fish_density: Record<string, number>;
}

export interface DeltaMessage {
  type: "delta";
  tick: number;
  phase: Phase;
  creatures: CreatureDto[];
  events: WorldEventDto[];
  fish_density?: Record<string, number>;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export type ServerMessage = SnapshotMessage | DeltaMessage | ErrorMessage;

export interface ViewportMessage {
  type: "viewport";
  x: number;
  y: number;
  width: number;
  height: number;
}
