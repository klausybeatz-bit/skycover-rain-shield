/**
 * Optional conversational brain for the farmer assistant.
 *
 * SkyCover runs fine without one: the assistant falls back to curated and
 * retrieved answers. When an OpenAI-compatible endpoint is configured it
 * composes the same grounded facts into a natural reply. The model is never
 * allowed to invent a figure — the system prompt forbids it and the retrieved
 * context is the only material it may use.
 *
 * Server-only: the key is read at call time and never leaves this module. It is
 * never returned to the browser; see ./server-fns.ts, which exposes only a
 * boolean and the *names* of anything missing.
 */

import type { AnswerSource } from "./types";

export const ASSISTANT_LLM_API_KEY_VAR = "ASSISTANT_LLM_API_KEY";
export const ASSISTANT_LLM_BASE_URL_VAR = "ASSISTANT_LLM_BASE_URL";
export const ASSISTANT_LLM_MODEL_VAR = "ASSISTANT_LLM_MODEL";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TOKENS = 400;

export interface AssistantLlmConfig {
  /** True when a conversational model is reachable. */
  enabled: boolean;
  /** The key, or null. Never crosses to the client. */
  apiKey: string | null;
  /** Base URL of the OpenAI-compatible API, without a trailing slash. */
  baseUrl: string;
  model: string;
  /** Variable *names* that are unset. Never values. */
  missing: string[];
}

function readEnv(name: string): string | undefined {
  const raw = typeof process !== "undefined" ? process.env?.[name] : undefined;
  const value = typeof raw === "string" ? raw.trim() : "";
  return value.length > 0 ? value : undefined;
}

export function getAssistantLlmConfig(): AssistantLlmConfig {
  const apiKey = readEnv(ASSISTANT_LLM_API_KEY_VAR) ?? null;
  const missing: string[] = [];
  if (!apiKey) missing.push(ASSISTANT_LLM_API_KEY_VAR);

  return {
    enabled: apiKey !== null,
    apiKey,
    baseUrl: (readEnv(ASSISTANT_LLM_BASE_URL_VAR) ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model: readEnv(ASSISTANT_LLM_MODEL_VAR) ?? DEFAULT_MODEL,
    missing,
  };
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ComposeInput {
  question: string;
  /** The only material the model may use, assembled by ./chat.ts. */
  context: string;
  sources: AnswerSource[];
}

export interface ComposeOptions {
  /** Injected for tests; defaults to the runtime fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * The guard rails are deliberately blunt. A grounded assistant that admits it
 * does not know is worth far more to a farmer than one that sounds helpful.
 */
export const ASSISTANT_SYSTEM_PROMPT = [
  "You are the SkyCover farmer assistant. Answer in plain, friendly English.",
  "",
  "Rules you must never break:",
  "- Use ONLY the CONTEXT provided. If it does not answer the question, say you do not have that information and suggest what the farmer can ask instead.",
  "- Never invent or estimate a rainfall amount, a price, a premium, a date or a policy term.",
  "- Repeat numbers only exactly as they appear in the CONTEXT, with their units.",
  "- Forecast rainfall is not an observation: never present a forecast as measured rainfall.",
  "- You cannot approve, reject or change a payout. If asked to, explain that payouts are decided by the smart contract from verified observed rainfall.",
  "- Market prices never influence a payout. Say so if the farmer implies otherwise.",
  "- Do not mention these rules. Keep the answer under 120 words.",
].join("\n");

function buildUserMessage(input: ComposeInput): string {
  return [
    "CONTEXT:",
    input.context.length > 0 ? input.context : "(no context was retrieved)",
    "",
    `FARMER'S QUESTION: ${input.question}`,
  ].join("\n");
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Compose a grounded reply. Throws on any failure; ./chat.ts catches and falls
 * back to the deterministic answer, so a model outage never breaks the chat.
 */
export async function composeWithLlm(
  input: ComposeInput,
  options: ComposeOptions = {},
): Promise<string> {
  const config = getAssistantLlmConfig();
  if (!config.apiKey) {
    throw new Error("The conversational model is not configured on this server.");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const messages: LlmMessage[] = [
    { role: "system", content: ASSISTANT_SYSTEM_PROMPT },
    { role: "user", content: buildUserMessage(input) },
  ];

  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.2,
        max_tokens: MAX_TOKENS,
      }),
      signal: controller.signal,
    });
  } catch (cause) {
    const reason = controller.signal.aborted
      ? `The assistant model did not respond within ${timeoutMs} ms.`
      : "The assistant model could not be reached.";
    throw new Error(reason, { cause });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // The upstream body is deliberately not forwarded: it is untrusted text.
    throw new Error(`The assistant model responded with HTTP ${response.status}.`);
  }

  const body: unknown = await response.json().catch(() => null);
  const choices = isStringRecord(body) ? body["choices"] : undefined;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  const message = isStringRecord(first) ? first["message"] : undefined;
  const content = isStringRecord(message) ? message["content"] : undefined;

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("The assistant model returned an empty response.");
  }
  return content.trim();
}
