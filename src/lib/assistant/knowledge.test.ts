import { describe, expect, it } from "vitest";

import { KNOWLEDGE_BASE, knowledgeSource, listTopics, matchKnowledge } from "./knowledge";

describe("assistant knowledge base", () => {
  it("answers every curated question with its own entry", () => {
    for (const entry of KNOWLEDGE_BASE) {
      expect(matchKnowledge(entry.question)?.id).toBe(entry.id);
    }
  });

  it("matches the same fact asked in the farmer's own words", () => {
    expect(matchKnowledge("How do I buy a policy?")?.id).toBe("buy-policy");
    expect(matchKnowledge("where does the rainfall data come from")?.id).toBe("weather-source");
    expect(matchKnowledge("when will I get my money if it rains too much")?.id).toBe("payout-rule");
  });

  it("does not match on a single generic word", () => {
    expect(matchKnowledge("premium")).toBeNull();
  });

  it("returns null for an empty or unrelated question", () => {
    expect(matchKnowledge("")).toBeNull();
    expect(matchKnowledge("what is the weather on mars tomorrow")).toBeNull();
  });

  it("exposes a topic for every entry", () => {
    const topics = listTopics();
    expect(topics).toHaveLength(KNOWLEDGE_BASE.length);
    for (const topic of topics) {
      expect(topic.title.length).toBeGreaterThan(0);
      expect(topic.question.length).toBeGreaterThan(0);
    }
  });

  it("maps an entry to an in-app, un-timed source", () => {
    const entry = KNOWLEDGE_BASE[0]!;
    const source = knowledgeSource(entry);
    expect(source.kind).toBe("skycover");
    expect(source.url.startsWith("/")).toBe(true);
    expect(source.observedAt).toBeNull();
  });
});
