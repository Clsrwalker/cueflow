import { describe, expect, test } from "vitest";
import { fullTranscriptS3Key, rawChunkS3Key, summaryS3Key, type Cue } from "@cueflow/shared";
import { chunk } from "../test-helpers.js";
import { InMemoryCueFlowStore } from "./in-memory-store.js";

describe("InMemoryCueFlowStore", () => {
  test("stores and lists conversations by user with newest first", async () => {
    const store = new InMemoryCueFlowStore();

    await store.createConversation({
      conversationId: "conv_001",
      userId: "user_a",
      status: "ACTIVE",
      startedAt: "2026-06-16T10:00:00.000Z",
      endedAt: null,
      cueCount: 0,
      summaryStatus: "NOT_STARTED",
    });
    await store.createConversation({
      conversationId: "conv_002",
      userId: "user_a",
      status: "ACTIVE",
      startedAt: "2026-06-16T10:01:00.000Z",
      endedAt: null,
      cueCount: 0,
      summaryStatus: "NOT_STARTED",
    });
    await store.createConversation({
      conversationId: "conv_003",
      userId: "user_b",
      status: "ACTIVE",
      startedAt: "2026-06-16T10:02:00.000Z",
      endedAt: null,
      cueCount: 0,
      summaryStatus: "NOT_STARTED",
    });

    const conversations = await store.listConversations("user_a");

    expect(conversations.map((conversation) => conversation.conversationId)).toEqual(["conv_002", "conv_001"]);
  });

  test("stores transcript chunks, raw objects, full transcript, and summary objects", async () => {
    const store = new InMemoryCueFlowStore();
    const firstChunk = chunk({ chunkId: "000001", text: "We need a REST API for session history." });
    const rawKey = await store.putRawTranscriptChunk(firstChunk);
    const storedChunk = await store.putTranscriptChunk(firstChunk);

    const fullKey = await store.putFullTranscript("c_001", [storedChunk]);
    const summaryKey = await store.putSummary({
      conversationId: "c_001",
      summary: "The team discussed REST history APIs.",
      keyTopics: ["REST API lifecycle"],
      actionItems: ["Build the REST API."],
      risks: ["No major risks were explicitly identified in the transcript."],
      createdAt: "2026-06-16T10:10:00.000Z",
    });

    expect(rawKey).toBe(rawChunkS3Key("c_001", "000001"));
    expect(storedChunk.s3Key).toBe(rawChunkS3Key("c_001", "000001"));
    expect(fullKey).toBe(fullTranscriptS3Key("c_001"));
    expect(summaryKey).toBe(summaryS3Key("c_001"));
    expect(store.getObjectForTest(rawKey)).toMatchObject({ key: rawKey });
    expect(store.getObjectForTest(fullKey)).toMatchObject({ key: fullKey });
    expect(await store.getSummary("c_001")).toMatchObject({
      summary: "The team discussed REST history APIs.",
      keyTopics: ["REST API lifecycle"],
    });
  });

  test("stores cues and updates the conversation cue count", async () => {
    const store = new InMemoryCueFlowStore();
    await store.createConversation({
      conversationId: "c_001",
      userId: "demo-user",
      status: "ACTIVE",
      startedAt: "2026-06-16T10:00:00.000Z",
      endedAt: null,
      cueCount: 0,
      summaryStatus: "NOT_STARTED",
    });

    const cue: Cue = {
      conversationId: "c_001",
      cueId: "cue_001",
      type: "DECISION",
      title: "Architecture decision",
      shortText: "The team is choosing the real-time transport.",
      detailText: "Use the live channel for cue delivery and REST for history.",
      sourceChunkStart: "000001",
      sourceChunkEnd: "000002",
      confidence: 0.9,
      createdAt: "2026-06-16T10:00:05.000Z",
    };

    await store.putCue(cue);

    expect(await store.listCues("c_001")).toEqual([cue]);
    expect(await store.getConversation("c_001")).toMatchObject({ cueCount: 1 });
  });
});
