import { describe, expect, test } from "vitest";
import { ConversationService } from "../services/conversation-service.js";
import { InMemoryCueJobQueue } from "../queues/in-memory-cue-job-queue.js";
import { InMemoryCueFlowStore } from "../storage/in-memory-store.js";
import { InMemoryWebSocketMessenger } from "../websocket/messenger.js";
import { WebSocketService } from "../websocket/websocket-service.js";
import { createWebSocketHandler, type WebSocketResponse } from "./websocket.js";

function parseBody<T>(response: WebSocketResponse): T {
  return JSON.parse(response.body) as T;
}

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
  const handler = createWebSocketHandler(websockets);
  return { conversations, handler, messenger, queue, store };
}

describe("WebSocket handler", () => {
  test("handles connect, sendTranscript, ping, clientAckCue, and disconnect routes", async () => {
    const { conversations, handler, messenger, queue, store } = setup();
    const conversation = await conversations.createConversation({ userId: "user_a" });

    const connect = await handler({
      requestContext: { routeKey: "$connect", connectionId: "conn_001" },
      queryStringParameters: { conversationId: conversation.conversationId, userId: "user_a" },
    });
    const transcript = await handler({
      requestContext: { routeKey: "sendTranscript", connectionId: "conn_001" },
      body: JSON.stringify({
        action: "sendTranscript",
        conversationId: conversation.conversationId,
        chunkId: "000001",
        speaker: "speaker_1",
        text: "Should we use WebSocket push or REST polling for live cue delivery?",
        clientTimestamp: "2026-06-16T10:00:04.000Z",
      }),
    });
    const ping = await handler({
      requestContext: { routeKey: "ping", connectionId: "conn_001" },
      body: JSON.stringify({ action: "ping" }),
    });
    const cueAck = await handler({
      requestContext: { routeKey: "clientAckCue", connectionId: "conn_001" },
      body: JSON.stringify({
        action: "clientAckCue",
        conversationId: conversation.conversationId,
        cueId: "cue_001",
      }),
    });
    const disconnect = await handler({
      requestContext: { routeKey: "$disconnect", connectionId: "conn_001" },
    });

    expect(connect.statusCode).toBe(200);
    expect(transcript.statusCode).toBe(200);
    expect(parseBody<{ cueJobEnqueued: boolean; triggerReasons: string[] }>(transcript)).toMatchObject({
      cueJobEnqueued: true,
      triggerReasons: expect.arrayContaining(["QUESTION", "KEYWORD"]),
    });
    expect(ping.statusCode).toBe(200);
    expect(cueAck.statusCode).toBe(200);
    expect(disconnect.statusCode).toBe(200);
    expect(messenger.sentEventsForTest("conn_001")).toHaveLength(2);
    expect(queue.listJobsForTest()).toHaveLength(1);
    await expect(store.listConnections(conversation.conversationId)).resolves.toHaveLength(0);
  });

  test("uses action routing from the default route", async () => {
    const { conversations, handler } = setup();
    const conversation = await conversations.createConversation();
    await handler({
      requestContext: { routeKey: "$connect", connectionId: "conn_001" },
      queryStringParameters: { conversationId: conversation.conversationId, userId: "demo-user" },
    });

    const response = await handler({
      requestContext: { routeKey: "$default", connectionId: "conn_001" },
      body: JSON.stringify({ action: "ping" }),
    });

    expect(response.statusCode).toBe(200);
    expect(parseBody<{ event: { eventType: string } }>(response).event.eventType).toBe("pong");
  });

  test("returns JSON errors for invalid JSON, validation errors, and missing routes", async () => {
    const { conversations, handler } = setup();
    const conversation = await conversations.createConversation();
    await handler({
      requestContext: { routeKey: "$connect", connectionId: "conn_001" },
      queryStringParameters: { conversationId: conversation.conversationId, userId: "demo-user" },
    });

    const invalidJson = await handler({
      requestContext: { routeKey: "sendTranscript", connectionId: "conn_001" },
      body: "{",
    });
    const validation = await handler({
      requestContext: { routeKey: "sendTranscript", connectionId: "conn_001" },
      body: JSON.stringify({
        action: "sendTranscript",
        conversationId: conversation.conversationId,
        chunkId: "000001",
        speaker: "speaker_1",
        text: "",
        clientTimestamp: "bad-date",
      }),
    });
    const unknown = await handler({
      requestContext: { routeKey: "unknown", connectionId: "conn_001" },
      body: JSON.stringify({ action: "unknown" }),
    });

    expect(invalidJson.statusCode).toBe(400);
    expect(parseBody<{ error: { code: string } }>(invalidJson).error.code).toBe("INVALID_JSON");
    expect(validation.statusCode).toBe(400);
    expect(parseBody<{ error: { code: string } }>(validation).error.code).toBe("WEBSOCKET_VALIDATION_FAILED");
    expect(unknown.statusCode).toBe(404);
    expect(parseBody<{ error: { code: string } }>(unknown).error.code).toBe("WEBSOCKET_ROUTE_NOT_FOUND");
  });
});
