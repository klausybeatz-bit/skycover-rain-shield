/**
 * Types for the farmer assistant (grounded Q&A chat).
 *
 * Shared with the browser, so nothing here may hold a credential. Every reply
 * carries where it came from, because an assistant answer with no provenance is
 * indistinguishable from a confident guess.
 */

/** What grounded the answer. */
export type AssistantOrigin = "knowledge" | "live" | "web" | "none";

export interface AnswerSource {
  /** Stable id, e.g. "kb-payout-rule" or "open-meteo-forecast". */
  id: string;
  name: string;
  /** An absolute URL, or a SkyCover route path ("/buy") when kind is "skycover". */
  url: string;
  kind: "skycover" | "live" | "web";
  /** When the underlying data was observed/published (ISO 8601), when known. */
  observedAt: string | null;
}

export interface AssistantReply {
  /** Prose answer. Never states a figure that is not backed by `sources`. */
  answer: string;
  /** Where the answer was grounded. */
  origin: AssistantOrigin;
  /** True when a model composed the prose; false when it is a fixed template. */
  generated: boolean;
  /** True when the assistant could not ground the question at all. */
  insufficient: boolean;
  sources: AnswerSource[];
  /** Follow-up questions the farmer can tap. */
  suggestions: string[];
  /**
   * Names (never values) of variables the server is missing. Set when the
   * richer answer path needs a credential this deployment does not have.
   */
  missing: string[];
  answeredAt: string;
}

export interface AssistantTopic {
  title: string;
  question: string;
}

export interface AssistantConfig {
  /** True when a conversational model is configured (optional). */
  llmConfigured: boolean;
  /** Names (never values) of unset variables. */
  missing: string[];
  /** True when TinyFish web search is available for open questions. */
  tinyfishConfigured: boolean;
  /** Built-in questions the assistant answers without any credential. */
  topics: AssistantTopic[];
}

export interface AssistantLocation {
  name: string;
  latitude: number;
  longitude: number;
}

export interface AssistantQuestion {
  message: string;
  location?: AssistantLocation;
}
