import { describe, expect, test } from "vitest";
import { MockAiProvider } from "./mock-ai-provider.js";
import { chunk } from "../test-helpers.js";

describe("MockAiProvider", () => {
  const provider = new MockAiProvider();

  test("generates deterministic decision cues for WebSocket and REST choices", async () => {
    const cue = await provider.generateCue({
      conversationId: "c_001",
      chunks: [
        chunk({ chunkId: "000001", text: "Should we use WebSocket or REST polling for real-time AI cues?" }),
      ],
    });

    expect(cue.type).toBe("DECISION");
    expect(cue.title).toBe("Architecture decision");
    expect(cue.shortText).toContain("alternatives");
  });

  test("generates risk cues for latency and failure language", async () => {
    const cue = await provider.generateCue({
      conversationId: "c_001",
      chunks: [
        chunk({ chunkId: "000002", text: "The main risk is AI latency and model failure during the live session." }),
      ],
    });

    expect(cue.type).toBe("RISK");
    expect(cue.detailText).toContain("queue retries");
  });

  test("generates action cues for implementation language", async () => {
    const cue = await provider.generateCue({
      conversationId: "c_001",
      chunks: [
        chunk({ chunkId: "000003", text: "We should implement the summary worker next." }),
      ],
    });

    expect(cue.type).toBe("ACTION");
    expect(cue.shortText).toContain("next step");
  });

  test("generates concept cues for async queue architecture", async () => {
    const cue = await provider.generateCue({
      conversationId: "c_001",
      chunks: [
        chunk({ chunkId: "000004", text: "SQS lets the async worker process cue jobs outside the hot path." }),
      ],
    });

    expect(cue.type).toBe("CONCEPT");
    expect(cue.detailText).toContain("metadata");
  });

  test("delegates summary generation to the deterministic summary builder", async () => {
    const summary = await provider.generateSummary([
      chunk({ chunkId: "000001", text: "We need to design the cloud architecture for CueFlow." }),
      chunk({ chunkId: "000002", text: "The main risk is AI latency." }),
    ]);

    expect(summary.summary).toContain("The conversation focused on");
    expect(summary.actionItems).toEqual(expect.arrayContaining(["We need to design the cloud architecture for CueFlow."]));
    expect(summary.risks).toEqual(expect.arrayContaining(["The main risk is AI latency."]));
  });
});

