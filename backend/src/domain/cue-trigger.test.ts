import { describe, expect, test } from "vitest";
import { evaluateCueTrigger, TRIGGER_WORD_THRESHOLD } from "./cue-trigger.js";
import { chunk } from "../test-helpers.js";

describe("cue trigger policy", () => {
  test("suppresses cue generation when a cue job is already pending", () => {
    const result = evaluateCueTrigger({
      conversationId: "c_001",
      pendingCueJob: true,
      chunksSinceLastCue: [
        chunk({ chunkId: "000001", text: "Should we use WebSocket or REST polling for real-time AI cues?" }),
      ],
    });

    expect(result.shouldEnqueue).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  test("triggers on questions and decision keywords", () => {
    const result = evaluateCueTrigger({
      conversationId: "c_001",
      chunksSinceLastCue: [
        chunk({ chunkId: "000001", text: "Should we choose WebSocket or REST polling for real-time cue delivery?" }),
      ],
    });

    expect(result.shouldEnqueue).toBe(true);
    expect(result.reasons).toEqual(expect.arrayContaining(["QUESTION", "KEYWORD"]));
    expect(result.sourceChunkStart).toBe("000001");
    expect(result.sourceChunkEnd).toBe("000001");
    expect(result.triggerWindowId).toBe("c_001:000001:000001:11");
  });

  test("triggers when text since last cue exceeds the word threshold", () => {
    const longText = Array.from({ length: TRIGGER_WORD_THRESHOLD + 1 }, (_, index) => `word${index}`).join(" ");
    const result = evaluateCueTrigger({
      conversationId: "c_001",
      chunksSinceLastCue: [
        chunk({ chunkId: "000001", text: longText }),
      ],
    });

    expect(result.shouldEnqueue).toBe(true);
    expect(result.reasons).toContain("WORD_THRESHOLD");
    expect(result.wordCount).toBe(TRIGGER_WORD_THRESHOLD + 1);
  });

  test("triggers when more than 20 seconds have elapsed since the last cue", () => {
    const result = evaluateCueTrigger({
      conversationId: "c_001",
      lastCueCreatedAt: "2026-06-16T10:00:00.000Z",
      now: "2026-06-16T10:00:21.000Z",
      chunksSinceLastCue: [
        chunk({ chunkId: "000002", text: "The app should store transcript chunks immediately." }),
      ],
    });

    expect(result.shouldEnqueue).toBe(true);
    expect(result.reasons).toContain("TIME_THRESHOLD");
  });

  test("does not trigger for short low-signal text", () => {
    const result = evaluateCueTrigger({
      conversationId: "c_001",
      chunksSinceLastCue: [
        chunk({ chunkId: "000003", text: "That sounds good." }),
      ],
    });

    expect(result.shouldEnqueue).toBe(false);
    expect(result.triggerWindowId).toBeNull();
  });
});

