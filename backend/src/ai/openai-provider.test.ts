import { describe, expect, test } from "vitest";
import type OpenAI from "openai";
import { chunk } from "../test-helpers.js";
import { OpenAiProvider } from "./openai-provider.js";

function fakeClient(outputText: string, calls: unknown[] = []): OpenAI {
  return {
    responses: {
      async create(input: unknown) {
        calls.push(input);
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

  test("includes prepared context in cue prompts", async () => {
    const calls: unknown[] = [];
    const provider = new OpenAiProvider({
      client: fakeClient(JSON.stringify({
        type: "CONCEPT",
        title: "Prepared context",
        shortText: "Use the rubric context.",
        detailText: "Tie the cue to the selected prepared note.",
        confidence: 0.8,
      }), calls),
    });

    await provider.generateCue({
      conversationId: "conv_001",
      promptContext: "Course rubric: explain serverless trade-offs.",
      chunks: [
        chunk({ conversationId: "conv_001", chunkId: "000001", text: "We need to explain this clearly." }),
      ],
    });

    expect(JSON.stringify(calls[0])).toContain("Prepared context:");
    expect(JSON.stringify(calls[0])).toContain("Course rubric: explain serverless trade-offs.");
    expect(JSON.stringify(calls[0])).toContain("Transcript:");
  });

  test("includes prepared context in summary prompts", async () => {
    const calls: unknown[] = [];
    const provider = new OpenAiProvider({
      client: fakeClient(JSON.stringify({
        summary: "The session used prepared context.",
        keyTopics: ["Prepared rubric"],
        actionItems: ["Mention the rubric in the demo."],
        risks: ["No major risks."],
      }), calls),
    });

    await provider.generateSummary([
      chunk({ conversationId: "conv_001", chunkId: "000001", text: "We should cover the grading criteria." }),
    ], {
      promptContext: "Prepared note: grading criteria and cloud-native requirements.",
    });

    expect(JSON.stringify(calls[0])).toContain("Prepared note: grading criteria and cloud-native requirements.");
  });
});
