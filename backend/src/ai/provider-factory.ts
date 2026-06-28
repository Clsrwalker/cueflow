import type { AiProvider } from "./types.js";
import { MockAiProvider } from "./mock-ai-provider.js";
import { OpenAiProvider } from "./openai-provider.js";

export type AiProviderName = "mock" | "openai";

export function aiProviderNameFromEnv(env: NodeJS.ProcessEnv = process.env): AiProviderName {
  const configured = env.CUEFLOW_AI_PROVIDER?.trim().toLowerCase();
  if (configured === "openai") return "openai";
  if (configured === "mock") return "mock";
  return env.OPENAI_API_KEY ? "openai" : "mock";
}

export function createAiProviderFromEnv(env: NodeJS.ProcessEnv = process.env): AiProvider {
  const provider = aiProviderNameFromEnv(env);
  if (provider === "openai") {
    return new OpenAiProvider({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
    });
  }
  return new MockAiProvider();
}
