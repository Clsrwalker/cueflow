import { describe, expect, test } from "vitest";
import { validateCueResult, validateSendTranscriptMessage, validateSummaryResult } from "./validation.js";

describe("CueFlow validation helpers", () => {
  test("accepts a valid sendTranscript WebSocket message", () => {
    const result = validateSendTranscriptMessage({
      action: "sendTranscript",
      conversationId: "c_001",
      chunkId: "000001",
      speaker: "speaker_1",
      text: "Should we use WebSocket or REST polling for AI cues?",
      clientTimestamp: "2026-06-16T10:00:05.000Z",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.conversationId).toBe("c_001");
      expect(result.value.text).toContain("WebSocket");
    }
  });

  test("rejects malformed sendTranscript messages", () => {
    const result = validateSendTranscriptMessage({
      action: "ping",
      conversationId: "",
      chunkId: "000001",
      speaker: "speaker_1",
      text: "",
      clientTimestamp: "not-a-date",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("action must be sendTranscript");
      expect(result.errors).toContain("conversationId must be a non-empty string");
      expect(result.errors).toContain("text must be a non-empty string");
      expect(result.errors).toContain("clientTimestamp must be an ISO timestamp");
    }
  });

  test("validates cue results before persistence", () => {
    const result = validateCueResult({
      cueId: "cue_001",
      conversationId: "c_001",
      type: "DECISION",
      title: "WebSocket vs REST polling",
      shortText: "Use WebSocket for real-time cue delivery.",
      detailText: "REST remains better for history and summary retrieval.",
      sourceChunkStart: "000001",
      sourceChunkEnd: "000003",
      confidence: 0.86,
      createdAt: "2026-06-16T10:00:08.000Z",
    });

    expect(result.ok).toBe(true);
  });

  test("validates summary results", () => {
    const result = validateSummaryResult({
      conversationId: "c_001",
      summary: "The session focused on CueFlow architecture.",
      keyTopics: ["WebSocket", "SQS", "DynamoDB"],
      actionItems: ["Implement mock AI provider"],
      risks: ["AI latency"],
      createdAt: "2026-06-16T10:02:00.000Z",
    });

    expect(result.ok).toBe(true);
  });
});

