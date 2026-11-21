/**
 * The farmer assistant orchestrator.
 *
 * One question in, one grounded reply out. The order of work is deliberate:
 *   1. the curated SkyCover base answers product questions outright;
 *   2. live rainfall / mandi readings are pulled from the existing oracle
 *      modules when the question is about rain or prices;
 *   3. anything still unanswered goes to a cited TinyFish web lookup;
 *   4. a conversational model may rephrase that grounding, but it never adds a
 *      fact of its own, and its failure degrades to the template answer.
 *
 * The assistant is strictly informational: it has no path to a policy, a
 * payout or an on-chain report, and it says so when asked.
 */

import { getTinyFishConfig, TINYFISH_API_KEY_VAR } from "../tinyfish/config";
import { knowledgeSource, listTopics, matchKnowledge, type KnowledgeEntry } from "./knowledge";
import { ASSISTANT_LLM_API_KEY_VAR, composeWithLlm, getAssistantLlmConfig } from "./llm";
import {
  asksAboutPrice,
  asksAboutRain,
  retrieveLive,
  retrieveWeb,
  type RetrievedContext,
} from "./retrieve";
import type { AnswerSource, AssistantOrigin, AssistantQuestion, AssistantReply } from "./types";

export interface AssistantDeps {
  /** Injected for tests. */
  retrieveLive?: typeof retrieveLive;
  retrieveWeb?: typeof retrieveWeb;
  compose?: typeof composeWithLlm;
  now?: () => number;
}

const NO_GROUNDING =
  "I don't have a grounded answer for that yet. I can explain SkyCover's cover, premium, locations, payments and payouts, or look up live rainfall and mandi prices when those services are configured.";

function clip(text: string, max = 700): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
}

function joinNotes(...parts: ReadonlyArray<string | null>): string | null {
  const kept = parts.filter((part): part is string => typeof part === "string" && part.length > 0);
  return kept.length > 0 ? kept.join(" ") : null;
}

function dedupeSources(sources: AnswerSource[]): AnswerSource[] {
  const seen = new Set<string>();
  const out: AnswerSource[] = [];
  for (const source of sources) {
    const key = `${source.kind}:${source.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out;
}

function buildContext(
  knowledge: KnowledgeEntry | null,
  live: RetrievedContext | null,
  web: RetrievedContext | null,
): string {
  const parts: string[] = [];
  if (knowledge) parts.push(`[SkyCover] ${knowledge.title}\n${knowledge.answer}`);
  if (live)
    for (const block of live.blocks) parts.push(`[Live data] ${block.title}\n${block.body}`);
  if (web) for (const block of web.blocks) parts.push(`[Web] ${block.title}\n${block.body}`);
  return parts.join("\n\n");
}

function deterministicAnswer(
  knowledge: KnowledgeEntry | null,
  live: RetrievedContext | null,
  web: RetrievedContext | null,
): string {
  const parts: string[] = [];
  if (knowledge) parts.push(knowledge.answer);
  if (live) for (const block of live.blocks) parts.push(`${block.title}: ${block.body}`);
  if (web)
    for (const block of web.blocks.slice(0, 2)) parts.push(`${block.title} — ${clip(block.body)}`);
  if (parts.length === 0) {
    return joinNotes(live?.note ?? null, web?.note ?? null) ?? NO_GROUNDING;
  }
  return parts.join("\n\n");
}

function suggestionsFor(knowledge: KnowledgeEntry | null): string[] {
  const exclude = knowledge?.question;
  return listTopics()
    .map((topic) => topic.question)
    .filter((question) => question !== exclude)
    .slice(0, 3);
}

export async function answerQuestion(
  input: AssistantQuestion,
  deps: AssistantDeps = {},
): Promise<AssistantReply> {
  const now = deps.now ?? Date.now;
  const answeredAt = new Date(now()).toISOString();
  const question = input.message.trim();

  const tinyfish = getTinyFishConfig();
  const llm = getAssistantLlmConfig();
  const missing: string[] = [];
  if (!tinyfish.enabled) missing.push(TINYFISH_API_KEY_VAR);
  if (!llm.enabled) missing.push(ASSISTANT_LLM_API_KEY_VAR);

  if (question.length === 0) {
    return {
      answer:
        "Ask me anything about SkyCover — cover, premium, locations, payments, payouts — or about live rainfall and mandi prices.",
      origin: "none",
      generated: false,
      insufficient: true,
      sources: [],
      suggestions: suggestionsFor(null),
      missing,
      answeredAt,
    };
  }

  const knowledge = matchKnowledge(question);
  const runRetrieveLive = deps.retrieveLive ?? retrieveLive;
  const runRetrieveWeb = deps.retrieveWeb ?? retrieveWeb;
  const compose = deps.compose ?? composeWithLlm;

  const location = input.location ?? null;
  const wantsLive = asksAboutRain(question) || asksAboutPrice(question);
  const live = wantsLive ? await runRetrieveLive(question, location, {}) : null;

  const haveLive = (live?.blocks.length ?? 0) > 0;
  const web =
    knowledge === null && !haveLive && tinyfish.enabled ? await runRetrieveWeb(question, {}) : null;
  const haveWeb = (web?.blocks.length ?? 0) > 0;

  const sources = dedupeSources([
    ...(knowledge ? [knowledgeSource(knowledge)] : []),
    ...(live?.sources ?? []),
    ...(web?.sources ?? []),
  ]);

  const grounded = knowledge !== null || haveLive || haveWeb;
  const origin: AssistantOrigin =
    knowledge !== null ? "knowledge" : haveLive ? "live" : haveWeb ? "web" : "none";
  const fallback = deterministicAnswer(knowledge, live, web);
  const suggestions = suggestionsFor(knowledge);

  if (!llm.enabled || !grounded) {
    return {
      answer: fallback,
      origin,
      generated: false,
      insufficient: !grounded,
      sources,
      suggestions,
      missing,
      answeredAt,
    };
  }

  try {
    const answer = await compose(
      { question, context: buildContext(knowledge, live, web), sources },
      {},
    );
    return {
      answer,
      origin,
      generated: true,
      insufficient: false,
      sources,
      suggestions,
      missing,
      answeredAt,
    };
  } catch {
    // A model outage must never surface as a broken chat: fall back to the
    // grounded template, which is the same fact set the model would have used.
    return {
      answer: fallback,
      origin,
      generated: false,
      insufficient: false,
      sources,
      suggestions,
      missing,
      answeredAt,
    };
  }
}
