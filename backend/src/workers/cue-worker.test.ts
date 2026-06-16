import { describe, expect, test } from "vitest";
import type { AiProvider } from "../ai/types.js";
import { ConversationService } from "../services/conversation-service.js";
import { InMemoryCueJobQueue } from "../queues/in-memory-cue-job-queue.js";
import { InMemoryCueFlowStore } from "../storage/in-memory-store.js";
import { InMemoryWebSocketMessenger } from "../websocket/messenger.js";
import { CueWorker } from "./cue-worker.js";

function setup(aiProvider?: AiProvider) {
  let nextId = 0;
  const store = new InMemoryCueFlowStore();
  const queue = new InMemoryCueJobQueue();
  const messenger = new InMemoryWebSocketMessenger();
  const conversations = new ConversationService(store, {
    clock: () => new Date("2026-06-16T10:00:00.000Z"),
    idFactory: () => `${(++nextId).toString().padStart(6, "0")}`,
  });
  const worker = new CueWorker(store, queue, messenger, {
    aiProvider,
    clock: () => new Date("2026-06-16T10:00:08.000Z"),
    idFactory: () => `${(++nextId).toString().padStart(6, "0")}`,
  });
  return { conversations, messenger, queue, store, worker };
}

describe("CueWorker", () => {
  test("generates, stores, and pushes cue events from pending jobs", async () => {
    const { conversations, messenger, queue, store, worker } = setup();
    const conversation = await conversations.createConversation();
    await store.putConnection({
      connectionId: "conn_001",
      conversationId: conversation.conversationId,
      userId: conversation.userId,
      connectedAt: "2026-06-16T10:00:01.000Z",
    });
    await conversations.appendTranscriptChunk({
      conversationId: conversation.conversationId,
      chunkId: "000001",
      speaker: "speaker_1",
      text: "Should we use WebSocket push or REST polling for live cue delivery?",
      clientTimestamp: "2026-06-16T10:00:02.000Z",
    });
    await queue.enqueueCueJob({
      jobId: "cuejob_001",
      conversationId: conversation.conversationId,
      triggerWindowId: `${conversation.conversationId}:000001:000001:11`,
      sourceChunkStart: "000001",
      sourceChunkEnd: "000001",
      reasons: ["QUESTION", "KEYWORD"],
      wordCount: 11,
      enqueuedAt: "2026-06-16T10:00:03.000Z",
    });

    const result = await worker.processNext();

    expect(result.status).toBe("COMPLETED");
    if (result.status === "COMPLETED") {
      expect(result.cue).toMatchObject({
        cueId: "cue_000002",
        type: "DECISION",
        sourceChunkStart: "000001",
        sourceChunkEnd: "000001",
      });
      expect(result.deliveredCount).toBe(1);
    }
    await expect(store.listCues(conversation.conversationId)).resolves.toHaveLength(1);
    expect(queue.listJobsForTest()[0]).toMatchObject({ status: "COMPLETED", attempts: 1 });
    expect(messenger.sentEventsForTest("conn_001")[0].event).toMatchObject({
      eventType: "cue.created",
      conversationId: conversation.conversationId,
      cue: { type: "DECISION" },
    });
  });

  test("marks jobs failed when the provider rejects", async () => {
    const provider: AiProvider = {
      async generateCue() {
        throw new Error("provider unavailable");
      },
      async generateSummary() {
        throw new Error("summary is not used");
      },
    };
    const { conversations, queue, worker } = setup(provider);
    const conversation = await conversations.createConversation();
    await conversations.appendTranscriptChunk({
      conversationId: conversation.conversationId,
      chunkId: "000001",
      speaker: "speaker_1",
      text: "The main risk is latency.",
    });
    await queue.enqueueCueJob({
      jobId: "cuejob_001",
      conversationId: conversation.conversationId,
      triggerWindowId: `${conversation.conversationId}:000001:000001:5`,
      sourceChunkStart: "000001",
      sourceChunkEnd: "000001",
      reasons: ["KEYWORD"],
      wordCount: 5,
      enqueuedAt: "2026-06-16T10:00:03.000Z",
    });

    const result = await worker.processNext();

    expect(result).toMatchObject({
      status: "FAILED",
      error: "provider unavailable",
    });
    expect(queue.listJobsForTest()[0]).toMatchObject({ status: "FAILED", lastError: "provider unavailable" });
  });
});
