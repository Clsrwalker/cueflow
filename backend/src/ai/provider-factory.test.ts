import { describe, expect, test } from "vitest";
import { MockAiProvider } from "./mock-ai-provider.js";
import { OpenAiProvider } from "./openai-provider.js";
import { aiProviderNameFromEnv, createAiProviderFromEnv } from "./provider-factory.js";

describe("AI provider factory", () => {
  test("uses mock provider when no OpenAI configuration exists", () => {
    const env = {};

    expect(aiProviderNameFromEnv(env)).toBe("mock");
    expect(createAiProviderFromEnv(env)).toBeInstanceOf(MockAiProvider);
  });

  test("uses OpenAI provider when explicitly configured", () => {
    const env = {
      CUEFLOW_AI_PROVIDER: "openai",
      OPENAI_API_KEY: "test-key",
      OPENAI_MODEL: "gpt-5.4-mini",
    };

    expect(aiProviderNameFromEnv(env)).toBe("openai");
    expect(createAiProviderFromEnv(env)).toBeInstanceOf(OpenAiProvider);
  });

  test("allows mock provider to override an available OpenAI key", () => {
    const env = {
      CUEFLOW_AI_PROVIDER: "mock",
      OPENAI_API_KEY: "test-key",
    };

    expect(aiProviderNameFromEnv(env)).toBe("mock");
    expect(createAiProviderFromEnv(env)).toBeInstanceOf(MockAiProvider);
  });
});
