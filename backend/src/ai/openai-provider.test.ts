import { describe, expect, test } from "vitest";
import type OpenAI from "openai";
import { chunk } from "../test-helpers.js";
import { OpenAiProvider } from "./openai-provider.js";

function fakeClient(outputText: string): OpenAI {
  return {
    responses: {
      async create() {
        return {
          output_text: outputText,
        };
      },
    },
  } as unknown as OpenAI;
}

describe("OpenAiProvider", () => {
  test("generates cue results from structured Responses output", async () => {
    const provider = new OpenAiProvider({
      client: fakeClient(JSON.stringify({
        type: "DECISION",
        title: "Architecture decision",
        shortText: "Use WebSocket for live cue delivery.",
        detailText: "REST remains useful for history and summary retrieval.",
        confidence: 1.2,
      })),
    });

    const cue = await provider.generateCue({
      conversationId: "conv_001",
      chunks: [
        chunk({ conversationId: "conv_001", chunkId: "000001", text: "Should we use WebSocket or REST polling?" }),
      ],
    });

    expect(cue).toMatchObject({
      type: "DECISION",
      title: "Architecture decision",
      sourceChunkStart: "000001",
      sourceChunkEnd: "000001",
      confidence: 1,
    });
  });

  test("generates summaries from structured Responses output", async () => {
    const provider = new OpenAiProvider({
      client: fakeClient(JSON.stringify({
        summary: "The session focused on real-time cloud architecture.",
        keyTopics: ["WebSocket real-time delivery", "SQS async processing"],
        actionItems: ["Wire the OpenAI provider through environment configuration."],
        risks: ["Provider latency may affect worker completion time."],
      })),
    });

    const summary = await provider.generateSummary([
      chunk({ conversationId: "conv_001", chunkId: "000001", text: "We should use SQS for async cue generation." }),
    ]);

    expect(summary).toEqual({
      summary: "The session focused on real-time cloud architecture.",
      keyTopics: ["WebSocket real-time delivery", "SQS async processing"],
      actionItems: ["Wire the OpenAI provider through environment configuration."],
      risks: ["Provider latency may affect worker completion time."],
    });
  });

  test("rejects invalid model JSON", async () => {
    const provider = new OpenAiProvider({
      client: fakeClient("not json"),
    });

    await expect(provider.generateSummary([])).rejects.toThrow("Summary response was not valid JSON.");
  });
});
