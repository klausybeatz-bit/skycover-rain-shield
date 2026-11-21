/**
 * Server functions backing the farmer assistant chat.
 *
 * Both run on the server. The browser can ask a question and read the
 * non-secret configuration, and nothing else: it can never obtain the TinyFish
 * key, the model key, or a way to reach the oracle modules directly.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getTinyFishConfig } from "../tinyfish/config";
import { answerQuestion } from "./chat";
import { listTopics } from "./knowledge";
import { getAssistantLlmConfig } from "./llm";
import type { AssistantConfig, AssistantQuestion, AssistantReply } from "./types";

const locationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

/**
 * Public, non-secret view of what the assistant can reach. It reports *names*
 * of unset variables, never their values, so the UI can be honest about which
 * answer paths are available instead of implying more than exists.
 */
export const getAssistantConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<AssistantConfig> => {
    const llm = getAssistantLlmConfig();
    const tinyfish = getTinyFishConfig();

    const missing = [...llm.missing];
    if (!tinyfish.enabled) missing.push("TINYFISH_API_KEY");

    return {
      llmConfigured: llm.enabled,
      missing,
      tinyfishConfigured: tinyfish.enabled,
      topics: listTopics(),
    };
  },
);

/** Ask the assistant a grounded question. */
export const askAssistant = createServerFn({ method: "POST" })
  .validator(
    z.object({
      message: z.string().trim().min(1).max(800),
      location: locationSchema.optional(),
    }),
  )
  .handler(async ({ data }): Promise<AssistantReply> => {
    const input: AssistantQuestion = { message: data.message };
    if (data.location !== undefined) input.location = data.location;
    return answerQuestion(input);
  });
