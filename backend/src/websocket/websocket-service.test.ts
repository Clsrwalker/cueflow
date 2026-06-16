import { describe, expect, test } from "vitest";
import { ConversationService } from "../services/conversation-service.js";
import { InMemoryCueJobQueue } from "../queues/in-memory-cue-job-queue.js";
import { InMemoryCueFlowStore } from "../storage/in-memory-store.js";
import { InMemoryWebSocketMessenger } from "./messenger.js";
import {
  WebSocketService,
  WebSocketValidationError,
} from "./websocket-service.js";

function setup() {
  let nextId = 0;
  const store = new InMemoryCueFlowStore();
  const queue = new InMemoryCueJobQueue();
  const messenger = new InMemoryWebSocketMessenger();
  const conversations = new ConversationService(store, {
    clock: () => new Date("2026-06-16T10:00:00.000Z"),
    idFactory: () => `${(++nextId).toString().padStart(6, "0")}`,
  });
  const websockets = new WebSocketService(conversations, store, queue, messenger, {
    clock: () => new Date("2026-06-16T10:00:05.000Z"),
    idFactory: () => `${(++nextId).toString().padStart(6, "0")}`,
  });
  return { conversations, store, queue, messenger, websockets };
}

describe("WebSocketService", () => {
  test("connects and disconnects conversation-scoped WebSocket clients", async () => {
    const { conversations, store, websockets } = setup();
    const conversation = await conversations.createConversation({ userId: "user_a" });

    const connection = await websockets.connect({
      connectionId: "conn_001",
      conversationId: conversation.conversationId,
    });

    expect(connection).toMatchObject({
      connectionId: "conn_001",
      conversationId: conversation.conversationId,
      userId: "user_a",
    });
    await expect(store.listConnections(conversation.conversationId)).resolves.toHaveLength(1);

    await websockets.disconnect("conn_001");
    await expect(store.listConnections(conversation.conversationId)).resolves.toHaveLength(0);
  });

  test("persists transcript chunks, sends ack events, and skips low-signal cue jobs", async () => {
    const { conversations, store, queue, messenger, websockets } = setup();
    const conversation = await conversations.createConversation();
    await websockets.connect({ connectionId: "conn_001", conversationId: conversation.conversationId });

    const result = await websockets.sendTranscript("conn_001", {
      action: "sendTranscript",
      conversationId: conversation.conversationId,
      chunkId: "000001",
      speaker: "speaker_1",
      text: "That sounds good.",
      clientTimestamp: "2026-06-16T10:00:04.000Z",
    });

    expect(result.ack).toMatchObject({
      eventType: "transcript.ack",
      conversationId: conversation.conversationId,
      chunkId: "000001",
    });
    expect(result.cueJob).toBeNull();
    await expect(store.listTranscriptChunks(conversation.conversationId)).resolves.toHaveLength(1);
    expect(messenger.sentEventsForTest("conn_001")).toEqual([
      {
        connectionId: "conn_001",
        event: result.ack,
      },
    ]);
    await expect(queue.hasPendingCueJob(conversation.conversationId)).resolves.toBe(false);
  });

  test("enqueues one async cue job when trigger policy fires", async () => {
    const { conversations, queue, websockets } = setup();
    const conversation = await conversations.createConversation();
    await websockets.connect({ connectionId: "conn_001", conversationId: conversation.conversationId });

    const first = await websockets.sendTranscript("conn_001", {
      action: "sendTranscript",
      conversationId: conversation.conversationId,
      chunkId: "000001",
      speaker: "speaker_1",
      text: "Should we use WebSocket push or REST polling for live cue delivery?",
      clientTimestamp: "2026-06-16T10:00:04.000Z",
    });
    const second = await websockets.sendTranscript("conn_001", {
      action: "sendTranscript",
      conversationId: conversation.conversationId,
      chunkId: "000002",
      speaker: "speaker_1",
      text: "The main risk is latency if every transcript chunk calls AI.",
      clientTimestamp: "2026-06-16T10:00:05.000Z",
    });

    expect(first.cueJob).toMatchObject({
      status: "PENDING",
      reasons: expect.arrayContaining(["QUESTION", "KEYWORD"]),
      sourceChunkStart: "000001",
      sourceChunkEnd: "000001",
    });
    expect(second.cueJob).toBeNull();
    expect(queue.listJobsForTest()).toHaveLength(1);
  });

  test("rejects transcript messages for the wrong active conversation", async () => {
    const { conversations, websockets } = setup();
    const first = await conversations.createConversation();
    const second = await conversations.createConversation();
    await websockets.connect({ connectionId: "conn_001", conversationId: first.conversationId });

    await expect(websockets.sendTranscript("conn_001", {
      action: "sendTranscript",
      conversationId: second.conversationId,
      chunkId: "000001",
      speaker: "speaker_1",
      text: "Should we compare two options?",
      clientTimestamp: "2026-06-16T10:00:04.000Z",
    })).rejects.toBeInstanceOf(WebSocketValidationError);
  });

  test("sends pong events and accepts cue acknowledgements", async () => {
    const { conversations, messenger, websockets } = setup();
    const conversation = await conversations.createConversation();
    await websockets.connect({ connectionId: "conn_001", conversationId: conversation.conversationId });

    const pong = await websockets.ping("conn_001");
    const ack = await websockets.clientAckCue("conn_001", {
      action: "clientAckCue",
      conversationId: conversation.conversationId,
      cueId: "cue_001",
    });

    expect(pong).toEqual({
      eventType: "pong",
      receivedAt: "2026-06-16T10:00:05.000Z",
    });
    expect(ack).toMatchObject({ conversationId: conversation.conversationId, cueId: "cue_001" });
    expect(messenger.sentEventsForTest("conn_001")).toEqual([
      {
        connectionId: "conn_001",
        event: pong,
      },
    ]);
  });
});
