import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { answerQuestion } from "./chat";
import type { RetrievedContext } from "./retrieve";

const ENV_KEYS = [
  "TINYFISH_API_KEY",
  "ASSISTANT_LLM_API_KEY",
  "ASSISTANT_LLM_BASE_URL",
  "ASSISTANT_LLM_MODEL",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function emptyContext(): RetrievedContext {
  return { blocks: [], sources: [], origin: "none", note: null };
}

describe("farmer assistant orchestration", () => {
  it("answers a product question from the curated base with no credential", async () => {
    const live = vi.fn(async () => emptyContext());

    const reply = await answerQuestion(
      { message: "How do I buy a policy?" },
      { retrieveLive: live },
    );

    expect(reply.origin).toBe("knowledge");
    expect(reply.generated).toBe(false);
    expect(reply.insufficient).toBe(false);
    expect(reply.answer).toContain("Buy Insurance");
    expect(
      reply.sources.some((source) => source.kind === "skycover" && source.url === "/buy"),
    ).toBe(true);
    expect(live).not.toHaveBeenCalled();
    expect(reply.missing).toContain("TINYFISH_API_KEY");
    expect(reply.missing).toContain("ASSISTANT_LLM_API_KEY");
  });

  it("composes a natural reply when a model is configured", async () => {
    process.env["ASSISTANT_LLM_API_KEY"] = "test-key";
    const compose = vi.fn(async () => "SkyCover settles on verified observed rainfall.");

    const reply = await answerQuestion({ message: "How do payouts work?" }, { compose });

    expect(reply.generated).toBe(true);
    expect(reply.origin).toBe("knowledge");
    expect(reply.answer).toBe("SkyCover settles on verified observed rainfall.");
    expect(compose).toHaveBeenCalledTimes(1);
  });

  it("falls back to the grounded template when the model fails", async () => {
    process.env["ASSISTANT_LLM_API_KEY"] = "test-key";
    const compose = vi.fn(async () => {
      throw new Error("model exploded");
    });

    const reply = await answerQuestion({ message: "How do payouts work?" }, { compose });

    expect(reply.generated).toBe(false);
    expect(reply.origin).toBe("knowledge");
    expect(reply.answer).toContain("observed rainfall");
  });

  it("reports live rainfall when a location is supplied", async () => {
    const live = vi.fn(async (): Promise<RetrievedContext> => ({
      blocks: [{ title: "Observed rainfall — Munnar", body: "Today: 12 mm." }],
      sources: [
        {
          id: "open-meteo-archive",
          name: "Open-Meteo",
          url: "https://open-meteo.com",
          kind: "live",
          observedAt: "2026-11-21T00:00:00.000Z",
        },
      ],
      origin: "live",
      note: null,
    }));

    const reply = await answerQuestion(
      {
        message: "How much rain fell this week?",
        location: { name: "Munnar, Kerala", latitude: 10.09, longitude: 77.06 },
      },
      { retrieveLive: live },
    );

    expect(reply.origin).toBe("live");
    expect(reply.insufficient).toBe(false);
    expect(reply.answer).toContain("Today: 12 mm.");
    expect(reply.sources.some((source) => source.kind === "live")).toBe(true);
    expect(live).toHaveBeenCalledTimes(1);
  });

  it("never reaches the web when the curated base already answers", async () => {
    process.env["TINYFISH_API_KEY"] = "test-key";
    const web = vi.fn(async () => {
      throw new Error("the web path must not be used here");
    });

    const reply = await answerQuestion({ message: "How do I buy a policy?" }, { retrieveWeb: web });

    expect(reply.origin).toBe("knowledge");
    expect(web).not.toHaveBeenCalled();
  });

  it("uses cited web sources for questions the base does not cover", async () => {
    process.env["TINYFISH_API_KEY"] = "test-key";
    const web = vi.fn(async (): Promise<RetrievedContext> => ({
      blocks: [{ title: "Kharif sowing guide", body: "Sow after the monsoon onset." }],
      sources: [
        {
          id: "https://example.gov",
          name: "example.gov",
          url: "https://example.gov",
          kind: "web",
          observedAt: null,
        },
      ],
      origin: "web",
      note: null,
    }));

    const reply = await answerQuestion(
      { message: "When should I sow kharif crops?" },
      { retrieveWeb: web },
    );

    expect(reply.origin).toBe("web");
    expect(reply.insufficient).toBe(false);
    expect(reply.answer).toContain("Sow after the monsoon onset.");
    expect(web).toHaveBeenCalledTimes(1);
  });

  it("admits it cannot ground the question and never invents an answer", async () => {
    process.env["ASSISTANT_LLM_API_KEY"] = "test-key";
    const compose = vi.fn(async () => "should never be used");
    const live = vi.fn(async () => emptyContext());

    const reply = await answerQuestion(
      { message: "What is the msp for cotton?" },
      { retrieveLive: live, compose },
    );

    expect(reply.origin).toBe("none");
    expect(reply.insufficient).toBe(true);
    expect(reply.generated).toBe(false);
    expect(compose).not.toHaveBeenCalled();
    expect(reply.answer).toContain("don't have a grounded answer");
  });

  it("asks for a question when none was given", async () => {
    const reply = await answerQuestion({ message: "   " });

    expect(reply.insufficient).toBe(true);
    expect(reply.sources).toHaveLength(0);
    expect(reply.suggestions.length).toBeGreaterThan(0);
  });
});
