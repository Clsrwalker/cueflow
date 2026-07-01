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
    expect(result.suppressionReason).toBe("PENDING_JOB");
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
    expect(result.suppressionReason).toBeNull();
  });

  test("triggers on spoken STT questions without punctuation", () => {
    const result = evaluateCueTrigger({
      conversationId: "c_001",
      chunksSinceLastCue: [
        chunk({ chunkId: "000001", text: "how should we explain the websocket latency risk" }),
      ],
    });

    expect(result.shouldEnqueue).toBe(true);
    expect(result.reasons).toEqual(expect.arrayContaining(["QUESTION", "KEYWORD"]));
  });

  test("triggers on Chinese STT questions without punctuation", () => {
    const result = evaluateCueTrigger({
      conversationId: "c_001",
      chunksSinceLastCue: [
        chunk({ chunkId: "000001", text: "这个架构有什么问题应该怎么解决" }),
      ],
    });

    expect(result.shouldEnqueue).toBe(true);
    expect(result.reasons).toEqual(expect.arrayContaining(["QUESTION", "KEYWORD"]));
  });

  test("does not trigger on short audio checks", () => {
    const result = evaluateCueTrigger({
      conversationId: "c_001",
      chunksSinceLastCue: [
        chunk({ chunkId: "000001", text: "Hi, can you hear me okay?" }),
      ],
    });

    expect(result.shouldEnqueue).toBe(false);
    expect(result.suppressionReason).toBe("LOW_SIGNAL");
  });

  test("sends ordinary semantic statements to AI review without classifying them as questions", () => {
    const shouldStatement = evaluateCueTrigger({
      conversationId: "c_001",
      chunksSinceLastCue: [
        chunk({ chunkId: "000001", text: "I should probably leave after this" }),
      ],
    });
    const canStatement = evaluateCueTrigger({
      conversationId: "c_001",
      chunksSinceLastCue: [
        chunk({ chunkId: "000002", text: "We can do that later" }),
      ],
    });

    expect(shouldStatement.shouldEnqueue).toBe(true);
    expect(shouldStatement.reasons).toEqual(["AI_REVIEW"]);
    expect(canStatement.shouldEnqueue).toBe(true);
    expect(canStatement.reasons).toEqual(["AI_REVIEW"]);
  });

  test("sends non-keyword transcript chunks to AI review once they are meaningful", () => {
    const result = evaluateCueTrigger({
      conversationId: "c_001",
      chunksSinceLastCue: [
        chunk({ chunkId: "000001", text: "The browser keeps missing parts of the transcript" }),
      ],
    });

    expect(result.shouldEnqueue).toBe(true);
    expect(result.reasons).toEqual(["AI_REVIEW"]);
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

  test("triggers on fresh context after cooldown when enough words accumulated", () => {
    const result = evaluateCueTrigger({
      conversationId: "c_001",
      lastCueCreatedAt: "2026-06-16T10:00:00.000Z",
      now: "2026-06-16T10:00:21.000Z",
      chunksSinceLastCue: [
        chunk({ chunkId: "000002", text: "The app should store transcript chunks immediately and then use the queue worker for cue generation after the hot path." }),
      ],
    });

    expect(result.shouldEnqueue).toBe(true);
    expect(result.reasons).toContain("TIME_THRESHOLD");
  });

  test("suppresses strong signals while cue cooldown is active", () => {
    const result = evaluateCueTrigger({
      conversationId: "c_001",
      lastCueCreatedAt: "2026-06-16T10:00:00.000Z",
      now: "2026-06-16T10:00:01.000Z",
      chunksSinceLastCue: [
        chunk({ chunkId: "000002", text: "Should we explain the latency risk now?" }),
      ],
    });

    expect(result.shouldEnqueue).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining(["QUESTION", "KEYWORD"]));
    expect(result.suppressionReason).toBe("COOLDOWN");
    expect(result.cooldownRemainingMs).toBe(500);
  });

  test("allows a new direct question before the passive cooldown expires", () => {
    const result = evaluateCueTrigger({
      conversationId: "c_001",
      lastCueCreatedAt: "2026-06-16T10:00:00.000Z",
      now: "2026-06-16T10:00:10.000Z",
      chunksSinceLastCue: [
        chunk({ chunkId: "000002", text: "How should we explain the transcript persistence risk" }),
      ],
    });

    expect(result.shouldEnqueue).toBe(true);
    expect(result.reasons).toEqual(expect.arrayContaining(["QUESTION", "KEYWORD"]));
    expect(result.suppressionReason).toBeNull();
  });

  test("suppresses cue generation when auto cue is off", () => {
    const result = evaluateCueTrigger({
      conversationId: "c_001",
      autoCue: false,
      chunksSinceLastCue: [
        chunk({ chunkId: "000002", text: "Should we explain the latency risk now?" }),
      ],
    });

    expect(result.shouldEnqueue).toBe(false);
    expect(result.suppressionReason).toBe("AUTO_CUE_OFF");
  });

  test("suppresses cue generation after the per-minute display limit", () => {
    const result = evaluateCueTrigger({
      conversationId: "c_001",
      now: "2026-06-16T10:00:45.000Z",
      recentCueCreatedAts: [
        "2026-06-16T10:00:01.000Z",
        "2026-06-16T10:00:08.000Z",
        "2026-06-16T10:00:14.000Z",
        "2026-06-16T10:00:20.000Z",
        "2026-06-16T10:00:26.000Z",
        "2026-06-16T10:00:32.000Z",
        "2026-06-16T10:00:40.000Z",
        "2026-06-16T10:00:43.000Z",
      ],
      chunksSinceLastCue: [
        chunk({ chunkId: "000002", text: "Should we explain the latency risk now?" }),
      ],
    });

    expect(result.shouldEnqueue).toBe(false);
    expect(result.suppressionReason).toBe("RATE_LIMITED");
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
    expect(result.suppressionReason).toBe("LOW_SIGNAL");
  });
});
