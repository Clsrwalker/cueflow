import { describe, expect, test } from "vitest";
import type { AiProvider, CueContextWindow } from "../ai/types.js";
import { ConversationService } from "../services/conversation-service.js";
import { InMemoryCueJobQueue } from "../queues/in-memory-cue-job-queue.js";
import { InMemoryCueFlowStore } from "../storage/in-memory-store.js";
import { InMemoryWebSocketMessenger } from "../websocket/messenger.js";
import { CueWorker } from "./cue-worker.js";

function setup(aiProvider?: AiProvider, workerOptions: Omit<ConstructorParameters<typeof CueWorker>[3], "aiProvider" | "clock" | "idFactory"> = {}) {
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
    ...workerOptions,
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

  test("passes prepared note prompt context to the AI provider", async () => {
    let receivedContext: CueContextWindow | null = null;
    const provider: AiProvider = {
      async generateCue(contextWindow) {
        receivedContext = contextWindow;
        return {
          type: "CONCEPT",
          title: "Prepared context",
          shortText: "The cue used the selected prepared note.",
          detailText: "The provider received prompt context from the cue job.",
          sourceChunkStart: "000001",
          sourceChunkEnd: "000001",
          confidence: 0.91,
        };
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
      text: "Should we discuss the cloud architecture trade-offs?",
    });
    await queue.enqueueCueJob({
      jobId: "cuejob_001",
      conversationId: conversation.conversationId,
      triggerWindowId: `${conversation.conversationId}:000001:000001:7`,
      sourceChunkStart: "000001",
      sourceChunkEnd: "000001",
      reasons: ["QUESTION"],
      wordCount: 7,
      enqueuedAt: "2026-06-16T10:00:03.000Z",
      promptContext: "Prepared context: Course Rubric\nExplain serverless trade-offs.",
    });

    const result = await worker.processNext();

    expect(result.status).toBe("COMPLETED");
    expect(receivedContext?.promptContext).toBe("Prepared context: Course Rubric\nExplain serverless trade-offs.");
  });

  test("uses the job source range instead of pulling prior cue context into the model window", async () => {
    let receivedContext: CueContextWindow | null = null;
    const provider: AiProvider = {
      async generateCue(contextWindow) {
        receivedContext = contextWindow;
        return {
          type: "ACTION",
          title: "Source scoped",
          shortText: "Only the current source range should drive the cue.",
          detailText: "Prior cue context should not be included when the job has an explicit source range.",
          sourceChunkStart: "000003",
          sourceChunkEnd: "000003",
          confidence: 0.91,
        };
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
      text: "Should we use WebSocket or REST polling?",
    });
    await conversations.appendTranscriptChunk({
      conversationId: conversation.conversationId,
      chunkId: "000002",
      speaker: "speaker_1",
      text: "Use WebSocket for live delivery and REST for history.",
    });
    await conversations.appendTranscriptChunk({
      conversationId: conversation.conversationId,
      chunkId: "000003",
      speaker: "speaker_1",
      text: "Now the action item is to add duplicate suppression.",
    });
    await queue.enqueueCueJob({
      jobId: "cuejob_001",
      conversationId: conversation.conversationId,
      triggerWindowId: `${conversation.conversationId}:000003:000003:8`,
      sourceChunkStart: "000003",
      sourceChunkEnd: "000003",
      reasons: ["KEYWORD"],
      wordCount: 8,
      enqueuedAt: "2026-06-16T10:00:03.000Z",
    });

    await worker.processNext();

    expect(receivedContext?.chunks.map((chunk) => chunk.chunkId)).toEqual(["000003"]);
  });

  test("completes and skips cue jobs when the provider chooses no display", async () => {
    const provider: AiProvider = {
      async generateCue() {
        return {
          display: false,
          skipReason: "model chose no cue",
          sourceChunkStart: "000001",
          sourceChunkEnd: "000001",
          confidence: 0.1,
        };
      },
      async generateSummary() {
        throw new Error("summary is not used");
      },
    };
    const { conversations, messenger, queue, store, worker } = setup(provider);
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
      text: "Okay, sounds good.",
    });
    await queue.enqueueCueJob({
      jobId: "cuejob_001",
      conversationId: conversation.conversationId,
      triggerWindowId: `${conversation.conversationId}:000001:000001:3`,
      sourceChunkStart: "000001",
      sourceChunkEnd: "000001",
      reasons: ["QUESTION"],
      wordCount: 3,
      enqueuedAt: "2026-06-16T10:00:03.000Z",
    });

    const result = await worker.processNext();

    expect(result).toMatchObject({ status: "SKIPPED", reason: "model chose no cue" });
    await expect(store.listCues(conversation.conversationId)).resolves.toHaveLength(0);
    expect(messenger.sentEventsForTest("conn_001")).toHaveLength(0);
    expect(queue.listJobsForTest()[0]).toMatchObject({ status: "COMPLETED", attempts: 1 });
  });

  test("skips low-confidence generated cues", async () => {
    const lowConfidenceProvider: AiProvider = {
      async generateCue() {
        return {
          type: "ACTION",
          title: "Weak action",
          shortText: "This cue is too uncertain.",
          detailText: "The worker should not display low confidence cue cards.",
          sourceChunkStart: "000001",
          sourceChunkEnd: "000001",
          confidence: 0.4,
        };
      },
      async generateSummary() {
        throw new Error("summary is not used");
      },
    };
    const { conversations, queue, store, worker } = setup(lowConfidenceProvider, { confidenceThreshold: 0.75 });
    const conversation = await conversations.createConversation();
    await conversations.appendTranscriptChunk({
      conversationId: conversation.conversationId,
      chunkId: "000001",
      speaker: "speaker_1",
      text: "Should we discuss a risky trade-off?",
    });
    await queue.enqueueCueJob({
      jobId: "cuejob_low",
      conversationId: conversation.conversationId,
      triggerWindowId: `${conversation.conversationId}:000001:000001:6`,
      sourceChunkStart: "000001",
      sourceChunkEnd: "000001",
      reasons: ["QUESTION"],
      wordCount: 6,
      enqueuedAt: "2026-06-16T10:00:03.000Z",
    });

    const low = await worker.processNext();

    expect(low).toMatchObject({ status: "SKIPPED", reason: "low_confidence:0.40" });
    await expect(store.listCues(conversation.conversationId)).resolves.toHaveLength(0);
  });

  test("allows direct question cues below the normal confidence threshold", async () => {
    const questionProvider: AiProvider = {
      async generateCue() {
        return {
          type: "ACTION",
          title: "Answer the spoken question",
          shortText: "Use the recent transcript context to answer the user's question.",
          detailText: "Spoken STT questions may not include punctuation, so the worker should still display useful cue cards when confidence is acceptable for a question.",
          sourceChunkStart: "000001",
          sourceChunkEnd: "000001",
          confidence: 0.6,
        };
      },
      async generateSummary() {
        throw new Error("summary is not used");
      },
    };
    const { conversations, queue, store, worker } = setup(questionProvider, {
      confidenceThreshold: 0.75,
      questionConfidenceThreshold: 0.55,
    });
    const conversation = await conversations.createConversation();
    await conversations.appendTranscriptChunk({
      conversationId: conversation.conversationId,
      chunkId: "000001",
      speaker: "speaker_1",
      text: "how should we explain the websocket latency risk",
    });
    await queue.enqueueCueJob({
      jobId: "cuejob_question",
      conversationId: conversation.conversationId,
      triggerWindowId: `${conversation.conversationId}:000001:000001:8`,
      sourceChunkStart: "000001",
      sourceChunkEnd: "000001",
      reasons: ["QUESTION", "KEYWORD"],
      wordCount: 8,
      enqueuedAt: "2026-06-16T10:00:03.000Z",
    });

    const result = await worker.processNext();

    expect(result.status).toBe("COMPLETED");
    await expect(store.listCues(conversation.conversationId)).resolves.toHaveLength(1);
  });

  test("allows AI review cues below the normal confidence threshold", async () => {
    const aiReviewProvider: AiProvider = {
      async generateCue() {
        return {
          type: "RISK",
          title: "Transcript quality issue",
          shortText: "Browser STT is missing parts of the transcript.",
          detailText: "This is useful enough to show as a cue even though it came from the broad AI review trigger.",
          sourceChunkStart: "000001",
          sourceChunkEnd: "000001",
          confidence: 0.62,
        };
      },
      async generateSummary() {
        throw new Error("summary is not used");
      },
    };
    const { conversations, queue, store, worker } = setup(aiReviewProvider, {
      confidenceThreshold: 0.75,
      aiReviewConfidenceThreshold: 0.6,
    });
    const conversation = await conversations.createConversation();
    await conversations.appendTranscriptChunk({
      conversationId: conversation.conversationId,
      chunkId: "000001",
      speaker: "speaker_1",
      text: "The browser keeps missing parts of the transcript",
    });
    await queue.enqueueCueJob({
      jobId: "cuejob_ai_review",
      conversationId: conversation.conversationId,
      triggerWindowId: `${conversation.conversationId}:000001:000001:8`,
      sourceChunkStart: "000001",
      sourceChunkEnd: "000001",
      reasons: ["AI_REVIEW"],
      wordCount: 8,
      enqueuedAt: "2026-06-16T10:00:03.000Z",
    });

    const result = await worker.processNext();

    expect(result.status).toBe("COMPLETED");
    await expect(store.listCues(conversation.conversationId)).resolves.toHaveLength(1);
  });

  test("skips duplicate generated cues", async () => {
    const duplicateProvider: AiProvider = {
      async generateCue() {
        return {
          type: "RISK",
          title: "Latency risk",
          shortText: "AI calls may add latency.",
          detailText: "Queue model work so transcript ingestion stays responsive.",
          sourceChunkStart: "000002",
          sourceChunkEnd: "000002",
          confidence: 0.92,
        };
      },
      async generateSummary() {
        throw new Error("summary is not used");
      },
    };
    const { conversations, queue, store, worker } = setup(duplicateProvider);
    const conversation = await conversations.createConversation();
    await store.putCue({
      cueId: "cue_existing",
      conversationId: conversation.conversationId,
      type: "RISK",
      title: "Latency risk",
      shortText: "AI calls may add latency.",
      detailText: "Queue model work so transcript ingestion stays responsive.",
      sourceChunkStart: "000001",
      sourceChunkEnd: "000001",
      confidence: 0.9,
      createdAt: "2026-06-16T10:00:04.000Z",
    });
    await conversations.appendTranscriptChunk({
      conversationId: conversation.conversationId,
      chunkId: "000002",
      speaker: "speaker_1",
      text: "Can we avoid repeating the same latency advice?",
    });
    await queue.enqueueCueJob({
      jobId: "cuejob_duplicate",
      conversationId: conversation.conversationId,
      triggerWindowId: `${conversation.conversationId}:000002:000002:8`,
      sourceChunkStart: "000002",
      sourceChunkEnd: "000002",
      reasons: ["QUESTION"],
      wordCount: 8,
      enqueuedAt: "2026-06-16T10:00:05.000Z",
    });

    const duplicate = await worker.processNext();

    expect(duplicate).toMatchObject({ status: "SKIPPED", reason: "duplicate_cue" });
    await expect(store.listCues(conversation.conversationId)).resolves.toHaveLength(1);
  });
});
