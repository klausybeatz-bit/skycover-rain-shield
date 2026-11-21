import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ASSISTANT_SYSTEM_PROMPT, composeWithLlm, getAssistantLlmConfig } from "./llm";

const ENV_KEYS = [
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("assistant model client", () => {
  it("reports itself unconfigured without a key", () => {
    const config = getAssistantLlmConfig();
    expect(config.enabled).toBe(false);
    expect(config.missing).toContain("ASSISTANT_LLM_API_KEY");
    expect(config.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("refuses to compose without a key", async () => {
    await expect(composeWithLlm({ question: "hi", context: "", sources: [] })).rejects.toThrow(
      /not configured/,
    );
  });

  it("sends the key as a bearer token and returns the model's text", async () => {
    process.env["ASSISTANT_LLM_API_KEY"] = "secret-key";
    process.env["ASSISTANT_LLM_BASE_URL"] = "https://llm.example.com/v1/";
    process.env["ASSISTANT_LLM_MODEL"] = "test-model";

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ choices: [{ message: { content: "  Grounded reply.  " } }] }),
    );

    const text = await composeWithLlm(
      { question: "Q", context: "CTX", sources: [] },
      { fetchImpl },
    );
    expect(text).toBe("Grounded reply.");

    const call = fetchImpl.mock.calls[0]!;
    expect(String(call[0])).toBe("https://llm.example.com/v1/chat/completions");
    const init = call[1]!;
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ authorization: "Bearer secret-key" });

    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("test-model");
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].content).toContain("Use ONLY the CONTEXT provided");
    expect(body.messages[1].content).toContain("CTX");
    expect(body.messages[1].content).toContain("Q");
  });

  it("forbids the model from inventing figures", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/Never invent/);
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/cannot approve, reject or change a payout/);
  });

  it("surfaces an upstream failure without leaking the raw body", async () => {
    process.env["ASSISTANT_LLM_API_KEY"] = "secret-key";
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response("internal detail", { status: 500 }),
    );

    await expect(
      composeWithLlm({ question: "Q", context: "", sources: [] }, { fetchImpl }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it("rejects an empty completion", async () => {
    process.env["ASSISTANT_LLM_API_KEY"] = "secret-key";
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ choices: [{ message: { content: "   " } }] }),
    );

    await expect(
      composeWithLlm({ question: "Q", context: "", sources: [] }, { fetchImpl }),
    ).rejects.toThrow(/empty response/);
  });

  it("times out rather than hanging a page", async () => {
    process.env["ASSISTANT_LLM_API_KEY"] = "secret-key";
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );

    await expect(
      composeWithLlm({ question: "Q", context: "", sources: [] }, { fetchImpl, timeoutMs: 5 }),
    ).rejects.toThrow(/did not respond within/);
  });
});
