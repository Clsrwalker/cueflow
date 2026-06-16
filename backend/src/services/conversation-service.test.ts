import { describe, expect, test } from "vitest";
import { fullTranscriptS3Key } from "@cueflow/shared";
import type { AiProvider } from "../ai/types.js";
import { InMemoryCueFlowStore } from "../storage/in-memory-store.js";
import {
  ConversationClosedError,
  ConversationNotFoundError,
  ConversationService,
  DEFAULT_USER_ID,
  SummaryNotReadyError,
} from "./conversation-service.js";

function fixedService(store = new InMemoryCueFlowStore()): ConversationService {
  let nextId = 0;
  return new ConversationService(store, {
    clock: () => new Date("2026-06-16T10:00:00.000Z"),
    idFactory: () => `${(++nextId).toString().padStart(6, "0")}`,
  });
}

describe("ConversationService", () => {
  test("creates and lists conversations for the default user", async () => {
    const service = fixedService();

    const conversation = await service.createConversation();
    const conversations = await service.listConversations();

    expect(conversation).toMatchObject({
      conversationId: "conv_000001",
      userId: DEFAULT_USER_ID,
      status: "ACTIVE",
      cueCount: 0,
      summaryStatus: "NOT_STARTED",
    });
    expect(conversations).toEqual([conversation]);
  });

  test("appends transcript chunks, stores raw objects, and creates a ready summary when ending", async () => {
    const store = new InMemoryCueFlowStore();
    const service = fixedService(store);
    const conversation = await service.createConversation({ userId: "user_a" });

    const storedChunk = await service.appendTranscriptChunk({
      conversationId: conversation.conversationId,
      chunkId: "000001",
      speaker: "speaker_1",
      text: "We need to expose REST history and summary retrieval. The main risk is latency.",
      clientTimestamp: "2026-06-16T09:59:59.000Z",
    });
    const result = await service.endConversation(conversation.conversationId);

    expect(storedChunk.s3Key).toBe("raw/conv_000001/chunks/000001.json");
    expect(result.conversation).toMatchObject({
      status: "ENDED",
      endedAt: "2026-06-16T10:00:00.000Z",
      summaryStatus: "READY",
    });
    expect(result.summary.summary).toContain("REST API lifecycle");
    expect(result.summary.risks).toEqual(expect.arrayContaining(["The main risk is latency."]));
    expect(store.getObjectForTest(fullTranscriptS3Key(conversation.conversationId))).toMatchObject({
      key: fullTranscriptS3Key(conversation.conversationId),
    });
    await expect(service.getSummary(conversation.conversationId)).resolves.toEqual(result.summary);
  });

  test("records cues and exposes them in created order", async () => {
    const service = fixedService();
    const conversation = await service.createConversation();

    const cue = await service.recordCue({
      conversationId: conversation.conversationId,
      type: "ACTION",
      title: "Action item",
      shortText: "There is an implementation step.",
      detailText: "Capture the action item in the conversation summary.",
      sourceChunkStart: "000001",
      sourceChunkEnd: "000001",
      confidence: 0.82,
    });

    expect(cue.cueId).toBe("cue_000002");
    expect(await service.listCues(conversation.conversationId)).toEqual([cue]);
    await expect(service.getConversation(conversation.conversationId)).resolves.toMatchObject({ cueCount: 1 });
  });

  test("throws typed errors for missing, unfinished, and closed conversations", async () => {
    const service = fixedService();
    await expect(service.getConversation("missing")).rejects.toBeInstanceOf(ConversationNotFoundError);

    const conversation = await service.createConversation();
    await expect(service.getSummary(conversation.conversationId)).rejects.toBeInstanceOf(SummaryNotReadyError);

    await service.endConversation(conversation.conversationId);
    await expect(service.appendTranscriptChunk({
      conversationId: conversation.conversationId,
      speaker: "speaker_1",
      text: "This chunk arrives too late.",
    })).rejects.toBeInstanceOf(ConversationClosedError);
  });

  test("marks summary generation as failed when the provider rejects", async () => {
    const store = new InMemoryCueFlowStore();
    const provider: AiProvider = {
      async generateCue() {
        throw new Error("cue generation is not used in this test");
      },
      async generateSummary() {
        throw new Error("summary failed");
      },
    };
    const service = new ConversationService(store, {
      clock: () => new Date("2026-06-16T10:00:00.000Z"),
      idFactory: () => "000001",
      aiProvider: provider,
    });
    const conversation = await service.createConversation();

    await expect(service.endConversation(conversation.conversationId)).rejects.toThrow("summary failed");
    await expect(service.getConversation(conversation.conversationId)).resolves.toMatchObject({
      status: "ENDED",
      summaryStatus: "FAILED",
    });
  });
});
