import { describe, expect, test } from "vitest";
import { InMemorySummaryJobQueue } from "../queues/in-memory-summary-job-queue.js";
import { ConversationService } from "../services/conversation-service.js";
import { InMemoryCueFlowStore } from "../storage/in-memory-store.js";
import { createRestHandler, type RestResponse } from "./rest.js";

function parseBody<T>(response: RestResponse): T {
  return JSON.parse(response.body) as T;
}

function setup() {
  let nextId = 0;
  const store = new InMemoryCueFlowStore();
  const summaryQueue = new InMemorySummaryJobQueue();
  const transcriptionCalls: unknown[] = [];
  const transcriber = {
    async transcribe(input: unknown) {
      transcriptionCalls.push(input);
      return { text: "Should we use cloud transcription for the live demo?", model: "mock-transcribe", language: "english" as const };
    },
  };
  const service = new ConversationService(store, {
    clock: () => new Date("2026-06-16T10:00:00.000Z"),
    idFactory: () => `${(++nextId).toString().padStart(6, "0")}`,
  });
  const handler = createRestHandler(service, {
    summaryQueue,
    transcriber,
    clock: () => new Date("2026-06-16T10:00:01.000Z"),
    idFactory: () => `${(++nextId).toString().padStart(6, "0")}`,
  });
  return { handler, service, store, summaryQueue, transcriptionCalls };
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

  test("transcribes uploaded audio through the configured transcriber", async () => {
    const { handler, transcriptionCalls } = setup();

    const response = await handler({
      httpMethod: "POST",
      path: "/transcribe",
      body: JSON.stringify({
        audioBase64: Buffer.from("fake audio").toString("base64"),
        mimeType: "audio/webm;codecs=opus",
        language: "english",
        promptContext: "Prepared context: Demo interview.",
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(parseBody<{ transcript: string; model: string }>(response)).toEqual({
      transcript: "Should we use cloud transcription for the live demo?",
      model: "mock-transcribe",
      text: "Should we use cloud transcription for the live demo?",
      language: "english",
    });
    expect(transcriptionCalls).toEqual([
      {
        audioBase64: Buffer.from("fake audio").toString("base64"),
        mimeType: "audio/webm;codecs=opus",
        language: "english",
        promptContext: "Prepared context: Demo interview.",
      },
    ]);
  });

  test("returns conversation details, cues, and final summary", async () => {
    const { handler, service, summaryQueue } = setup();
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
    const endResponse = await handler({
      httpMethod: "POST",
      path: `/conversations/${conversation.conversationId}/end`,
      body: JSON.stringify({
        promptContext: "Prepared context: Course Rubric\nExplain cloud-native reliability.",
      }),
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(parseBody<{ conversation: { status: string } }>(detailResponse).conversation.status).toBe("ACTIVE");
    expect(cuesResponse.statusCode).toBe(200);
    expect(parseBody<{ cues: unknown[] }>(cuesResponse).cues).toHaveLength(1);
    expect(endResponse.statusCode).toBe(200);
    expect(parseBody<{ conversation: { summaryStatus: string }; summaryJobEnqueued: boolean }>(endResponse)).toMatchObject({
      conversation: { summaryStatus: "PENDING" },
      summaryJobEnqueued: true,
    });
    expect(summaryQueue.listJobsForTest()).toHaveLength(1);
    expect(summaryQueue.listJobsForTest()[0].promptContext).toBe("Prepared context: Course Rubric\nExplain cloud-native reliability.");
    await service.generateSummary(conversation.conversationId);
    const summaryResponse = await handler({ httpMethod: "GET", path: `/conversations/${conversation.conversationId}/summary` });
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

  test("hides conversation details from non-owners", async () => {
    const { handler, service } = setup();
    const conversation = await service.createConversation({ userId: "user_a" });

    const detailResponse = await handler({
      httpMethod: "GET",
      path: `/conversations/${conversation.conversationId}`,
      headers: { "x-cueflow-user-id": "user_b" },
    });
    const cuesResponse = await handler({
      httpMethod: "GET",
      path: `/conversations/${conversation.conversationId}/cues`,
      headers: { "x-cueflow-user-id": "user_b" },
    });

    expect(detailResponse.statusCode).toBe(404);
    expect(cuesResponse.statusCode).toBe(404);
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
