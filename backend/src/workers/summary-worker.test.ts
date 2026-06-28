import { describe, expect, test } from "vitest";
import type { AiProvider, SummaryProviderOptions } from "../ai/types.js";
import { ConversationService } from "../services/conversation-service.js";
import { InMemorySummaryJobQueue } from "../queues/in-memory-summary-job-queue.js";
import { InMemoryCueFlowStore } from "../storage/in-memory-store.js";
import { InMemoryWebSocketMessenger } from "../websocket/messenger.js";
import { SummaryWorker } from "./summary-worker.js";

function setup(aiProvider?: AiProvider) {
  let nextId = 0;
  const store = new InMemoryCueFlowStore();
  const queue = new InMemorySummaryJobQueue();
  const messenger = new InMemoryWebSocketMessenger();
  const conversations = new ConversationService(store, {
    clock: () => new Date("2026-06-16T10:00:00.000Z"),
    idFactory: () => `${(++nextId).toString().padStart(6, "0")}`,
    aiProvider,
  });
  const worker = new SummaryWorker(conversations, store, queue, messenger);
  return { conversations, messenger, queue, store, worker };
}

describe("SummaryWorker", () => {
  test("generates summaries, updates metadata, and pushes summary ready events", async () => {
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
      text: "We need to expose REST history retrieval. The main risk is latency.",
    });
    await conversations.endConversation(conversation.conversationId);
    await queue.enqueueSummaryJob({
      jobId: "summaryjob_001",
      conversationId: conversation.conversationId,
      enqueuedAt: "2026-06-16T10:00:03.000Z",
    });

    const result = await worker.processNext();

    expect(result.status).toBe("COMPLETED");
    if (result.status === "COMPLETED") {
      expect(result.result.conversation.summaryStatus).toBe("READY");
      expect(result.result.summary.summary).toContain("REST API lifecycle");
      expect(result.deliveredCount).toBe(1);
    }
    await expect(conversations.getSummary(conversation.conversationId)).resolves.toMatchObject({
      keyTopics: expect.arrayContaining(["REST API lifecycle"]),
    });
    expect(queue.listJobsForTest()[0]).toMatchObject({ status: "COMPLETED", attempts: 1 });
    expect(messenger.sentEventsForTest("conn_001")[0].event).toEqual({
      eventType: "summary.ready",
      conversationId: conversation.conversationId,
      summaryStatus: "READY",
    });
  });

  test("marks summary jobs failed when generation fails", async () => {
    const provider: AiProvider = {
      async generateCue() {
        throw new Error("cue is not used");
      },
      async generateSummary() {
        throw new Error("summary provider failed");
      },
    };
    const { conversations, queue, worker } = setup(provider);
    const conversation = await conversations.createConversation();
    await conversations.endConversation(conversation.conversationId);
    await queue.enqueueSummaryJob({
      jobId: "summaryjob_001",
      conversationId: conversation.conversationId,
      enqueuedAt: "2026-06-16T10:00:03.000Z",
    });

    const result = await worker.processNext();

    expect(result).toMatchObject({
      status: "FAILED",
      error: "summary provider failed",
    });
    expect(queue.listJobsForTest()[0]).toMatchObject({ status: "FAILED", lastError: "summary provider failed" });
    await expect(conversations.getConversation(conversation.conversationId)).resolves.toMatchObject({
      summaryStatus: "FAILED",
    });
  });

  test("passes prepared note prompt context to summary generation", async () => {
    let receivedOptions: SummaryProviderOptions | undefined;
    const provider: AiProvider = {
      async generateCue() {
        throw new Error("cue is not used");
      },
      async generateSummary(_chunks, options) {
        receivedOptions = options;
        return {
          summary: "The summary used prepared context.",
          keyTopics: ["Prepared notes"],
          actionItems: ["Use the selected prenote as prompt context."],
          risks: ["No major risks were explicitly identified."],
        };
      },
    };
    const { conversations, queue, worker } = setup(provider);
    const conversation = await conversations.createConversation();
    await conversations.appendTranscriptChunk({
      conversationId: conversation.conversationId,
      chunkId: "000001",
      speaker: "speaker_1",
      text: "We should explain the serverless trade-offs.",
    });
    await conversations.endConversation(conversation.conversationId, {
      promptContext: "Prepared context: Course Rubric\nExplain cloud-native requirements.",
    });
    await queue.enqueueSummaryJob({
      jobId: "summaryjob_001",
      conversationId: conversation.conversationId,
      enqueuedAt: "2026-06-16T10:00:03.000Z",
      promptContext: "Prepared context: Course Rubric\nExplain cloud-native requirements.",
    });

    const result = await worker.processNext();

    expect(result.status).toBe("COMPLETED");
    expect(receivedOptions?.promptContext).toBe("Prepared context: Course Rubric\nExplain cloud-native requirements.");
  });
});
