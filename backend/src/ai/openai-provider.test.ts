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
        reason: "clear architecture decision",
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

  test("returns a skipped cue result when the model chooses NONE", async () => {
    const provider = new OpenAiProvider({
      client: fakeClient(JSON.stringify({
        type: "NONE",
        title: "",
        shortText: "",
        detailText: "",
        confidence: 0.18,
        reason: "short filler without useful context",
      })),
    });

    const cue = await provider.generateCue({
      conversationId: "conv_001",
      chunks: [
        chunk({ conversationId: "conv_001", chunkId: "000001", text: "Okay, sounds good." }),
      ],
    });

    expect(cue).toMatchObject({
      display: false,
      skipReason: "short filler without useful context",
      sourceChunkStart: "000001",
      sourceChunkEnd: "000001",
      confidence: 0.18,
    });
  });

  test("compacts cue titles that repeat the cue content", async () => {
    const repeated = "Use SQS worker queues to process AI cue jobs asynchronously.";
    const provider = new OpenAiProvider({
      client: fakeClient(JSON.stringify({
        type: "ACTION",
        title: repeated,
        shortText: repeated,
        detailText: "Use SQS worker queues to process AI cue jobs asynchronously so transcript ingestion stays responsive.",
        confidence: 0.82,
        reason: "clear implementation step",
      })),
    });

    const cue = await provider.generateCue({
      conversationId: "conv_001",
      chunks: [
        chunk({ conversationId: "conv_001", chunkId: "000001", text: "How should I process cue jobs without blocking transcript ingestion?" }),
      ],
    });

    expect(cue).toMatchObject({
      type: "ACTION",
      title: "Next step",
      shortText: repeated,
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
        reason: "prepared context is directly relevant",
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
