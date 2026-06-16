import { describe, expect, test } from "vitest";
import { ConversationService } from "../services/conversation-service.js";
import { InMemoryCueFlowStore } from "../storage/in-memory-store.js";
import { createRestHandler, type RestResponse } from "./rest.js";

function parseBody<T>(response: RestResponse): T {
  return JSON.parse(response.body) as T;
}

function setup() {
  let nextId = 0;
  const store = new InMemoryCueFlowStore();
  const service = new ConversationService(store, {
    clock: () => new Date("2026-06-16T10:00:00.000Z"),
    idFactory: () => `${(++nextId).toString().padStart(6, "0")}`,
  });
  const handler = createRestHandler(service);
  return { handler, service, store };
}

describe("REST handler", () => {
  test("creates and lists conversations", async () => {
    const { handler } = setup();

    const createResponse = await handler({
      httpMethod: "POST",
      path: "/conversations",
      body: JSON.stringify({ userId: "user_a" }),
    });
    const listResponse = await handler({
      httpMethod: "GET",
      path: "/conversations",
      queryStringParameters: { userId: "user_a" },
    });

    expect(createResponse.statusCode).toBe(201);
    expect(parseBody<{ conversation: { conversationId: string } }>(createResponse).conversation.conversationId).toBe("conv_000001");
    expect(listResponse.statusCode).toBe(200);
    expect(parseBody<{ conversations: Array<{ conversationId: string }> }>(listResponse).conversations).toHaveLength(1);
  });

  test("returns conversation details, cues, and final summary", async () => {
    const { handler, service } = setup();
    const conversation = await service.createConversation();
    await service.appendTranscriptChunk({
      conversationId: conversation.conversationId,
      chunkId: "000001",
      speaker: "speaker_1",
      text: "We should expose REST history retrieval. The main risk is latency.",
    });
    await service.recordCue({
      conversationId: conversation.conversationId,
      type: "ACTION",
      title: "Action item",
      shortText: "There is a concrete next step.",
      detailText: "Capture the action in the summary.",
      sourceChunkStart: "000001",
      sourceChunkEnd: "000001",
      confidence: 0.8,
    });

    const detailResponse = await handler({ httpMethod: "GET", path: `/conversations/${conversation.conversationId}` });
    const cuesResponse = await handler({ httpMethod: "GET", path: `/conversations/${conversation.conversationId}/cues` });
    const endResponse = await handler({ httpMethod: "POST", path: `/conversations/${conversation.conversationId}/end` });
    const summaryResponse = await handler({ httpMethod: "GET", path: `/conversations/${conversation.conversationId}/summary` });

    expect(detailResponse.statusCode).toBe(200);
    expect(parseBody<{ conversation: { status: string } }>(detailResponse).conversation.status).toBe("ACTIVE");
    expect(cuesResponse.statusCode).toBe(200);
    expect(parseBody<{ cues: unknown[] }>(cuesResponse).cues).toHaveLength(1);
    expect(endResponse.statusCode).toBe(200);
    expect(parseBody<{ conversation: { summaryStatus: string } }>(endResponse).conversation.summaryStatus).toBe("READY");
    expect(summaryResponse.statusCode).toBe(200);
    expect(parseBody<{ summary: { summary: string } }>(summaryResponse).summary.summary).toContain("REST API lifecycle");
  });

  test("maps bad JSON, missing records, and unknown routes to JSON errors", async () => {
    const { handler } = setup();

    const invalidJson = await handler({
      httpMethod: "POST",
      path: "/conversations",
      body: "{",
    });
    const missing = await handler({
      httpMethod: "GET",
      path: "/conversations/missing",
    });
    const unknown = await handler({
      httpMethod: "GET",
      path: "/unknown",
    });

    expect(invalidJson.statusCode).toBe(400);
    expect(parseBody<{ error: { code: string } }>(invalidJson).error.code).toBe("INVALID_INPUT");
    expect(missing.statusCode).toBe(404);
    expect(parseBody<{ error: { code: string } }>(missing).error.code).toBe("CONVERSATION_NOT_FOUND");
    expect(unknown.statusCode).toBe(404);
    expect(parseBody<{ error: { code: string } }>(unknown).error.code).toBe("ROUTE_NOT_FOUND");
  });

  test("keeps the demo replay endpoint explicit until the scripted replay is added", async () => {
    const { handler } = setup();

    const response = await handler({
      httpMethod: "POST",
      path: "/demo/replay",
    });

    expect(response.statusCode).toBe(501);
    expect(parseBody<{ error: { code: string } }>(response).error.code).toBe("DEMO_REPLAY_NOT_IMPLEMENTED");
  });
});
