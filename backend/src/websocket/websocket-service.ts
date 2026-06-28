import type {
  PongEvent,
  TranscriptAckEvent,
  TranscriptChunk,
  WebSocketClientAckCueMessage,
  WebSocketConnection,
} from "@cueflow/shared";
import { validateSendTranscriptMessage } from "@cueflow/shared";
import { evaluateCueTrigger, type CueTriggerEvaluation } from "../domain/cue-trigger.js";
import type { CueJobQueue, StoredCueJob } from "../queues/types.js";
import type { CueFlowStore } from "../storage/types.js";
import type { ConversationService } from "../services/conversation-service.js";
import {
  ConversationServiceError,
  InvalidConversationInputError,
} from "../services/conversation-service.js";
import type { WebSocketMessenger } from "./messenger.js";

type Clock = () => Date;
type IdFactory = () => string;

export type WebSocketServiceOptions = {
  clock?: Clock;
  idFactory?: IdFactory;
  connectionTtlSeconds?: number;
};

export type ConnectInput = {
  connectionId: string;
  conversationId: string;
  userId?: string;
};

export type SendTranscriptResult = {
  ack: TranscriptAckEvent;
  chunk: TranscriptChunk;
  evaluation: CueTriggerEvaluation;
  cueJob: StoredCueJob | null;
};

export type ClientAckCueResult = {
  conversationId: string;
  cueId: string;
  acceptedAt: string;
};

export class WebSocketServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "WebSocketServiceError";
  }
}

export class WebSocketValidationError extends WebSocketServiceError {
  constructor(message: string) {
    super("WEBSOCKET_VALIDATION_FAILED", message, 400);
  }
}

export class WebSocketConnectionNotFoundError extends WebSocketServiceError {
  constructor(connectionId: string) {
    super("WEBSOCKET_CONNECTION_NOT_FOUND", `WebSocket connection ${connectionId} was not found.`, 404);
  }
}

function defaultIdFactory(): string {
  return Math.random().toString(36).slice(2, 12);
}

function requiredString(value: string | undefined, field: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new WebSocketValidationError(`${field} is required.`);
  }
  return trimmed;
}

function lastCueCreatedAt(cues: Awaited<ReturnType<CueFlowStore["listCues"]>>): string | null {
  return [...cues].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.createdAt ?? null;
}

function chunksSinceLastCue(
  chunks: TranscriptChunk[],
  cues: Awaited<ReturnType<CueFlowStore["listCues"]>>,
): TranscriptChunk[] {
  const latestCue = [...cues].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!latestCue) return chunks;

  const sourceEndIndex = chunks.findIndex((chunk) => chunk.chunkId === latestCue.sourceChunkEnd);
  if (sourceEndIndex >= 0) {
    return chunks.slice(sourceEndIndex + 1);
  }

  return chunks.filter((chunk) => chunk.createdAt > latestCue.createdAt);
}

export class WebSocketService {
  private readonly clock: Clock;
  private readonly idFactory: IdFactory;
  private readonly connectionTtlSeconds: number;

  constructor(
    private readonly conversations: ConversationService,
    private readonly store: CueFlowStore,
    private readonly queue: CueJobQueue,
    private readonly messenger: WebSocketMessenger,
    options: WebSocketServiceOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? defaultIdFactory;
    this.connectionTtlSeconds = options.connectionTtlSeconds ?? 24 * 60 * 60;
  }

  async connect(input: ConnectInput): Promise<WebSocketConnection> {
    const connectionId = requiredString(input.connectionId, "connectionId");
    const conversationId = requiredString(input.conversationId, "conversationId");
    const conversation = await this.conversations.getConversation(conversationId);
    const now = this.clock();
    const connection: WebSocketConnection = {
      connectionId,
      conversationId,
      userId: input.userId?.trim() || conversation.userId,
      connectedAt: now.toISOString(),
      ttl: Math.floor(now.getTime() / 1000) + this.connectionTtlSeconds,
    };
    return this.store.putConnection(connection);
  }

  async disconnect(connectionId: string): Promise<WebSocketConnection | null> {
    return this.store.deleteConnection(requiredString(connectionId, "connectionId"));
  }

  async sendTranscript(connectionId: string, payload: unknown): Promise<SendTranscriptResult> {
    const connection = await this.requireConnection(connectionId);
    const validation = validateSendTranscriptMessage(payload);
    if (!validation.ok) {
      throw new WebSocketValidationError(validation.errors.join("; "));
    }

    if (validation.value.conversationId !== connection.conversationId) {
      throw new WebSocketValidationError("conversationId must match the active WebSocket connection.");
    }

    const chunk = await this.conversations.appendTranscriptChunk({
      conversationId: validation.value.conversationId,
      chunkId: validation.value.chunkId,
      speaker: validation.value.speaker,
      text: validation.value.text,
      clientTimestamp: validation.value.clientTimestamp,
    });

    const chunks = await this.store.listTranscriptChunks(chunk.conversationId);
    const cues = await this.store.listCues(chunk.conversationId);
    const pendingCueJob = await this.queue.hasPendingCueJob(chunk.conversationId);
    const evaluation = evaluateCueTrigger({
      conversationId: chunk.conversationId,
      chunksSinceLastCue: chunksSinceLastCue(chunks, cues),
      lastCueCreatedAt: lastCueCreatedAt(cues),
      now: this.nowIso(),
      pendingCueJob,
    });

    const cueJob = evaluation.shouldEnqueue
      ? await this.queue.enqueueCueJob({
          jobId: `cuejob_${this.idFactory()}`,
          conversationId: chunk.conversationId,
          triggerWindowId: evaluation.triggerWindowId ?? `${chunk.conversationId}:${chunk.chunkId}`,
          sourceChunkStart: evaluation.sourceChunkStart ?? chunk.chunkId,
          sourceChunkEnd: evaluation.sourceChunkEnd ?? chunk.chunkId,
          reasons: evaluation.reasons,
          wordCount: evaluation.wordCount,
          enqueuedAt: this.nowIso(),
          ...(validation.value.promptContext ? { promptContext: validation.value.promptContext } : {}),
        })
      : null;

    const ack: TranscriptAckEvent = {
      eventType: "transcript.ack",
      conversationId: chunk.conversationId,
      chunkId: chunk.chunkId,
      receivedAt: chunk.createdAt,
    };
    await this.messenger.sendToConnection(connection.connectionId, ack);

    return {
      ack,
      chunk,
      evaluation,
      cueJob,
    };
  }

  async ping(connectionId: string): Promise<PongEvent> {
    const connection = await this.requireConnection(connectionId);
    const event: PongEvent = {
      eventType: "pong",
      receivedAt: this.nowIso(),
    };
    await this.messenger.sendToConnection(connection.connectionId, event);
    return event;
  }

  async clientAckCue(connectionId: string, payload: unknown): Promise<ClientAckCueResult> {
    const connection = await this.requireConnection(connectionId);
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new WebSocketValidationError("clientAckCue payload must be an object.");
    }

    const message = payload as Partial<WebSocketClientAckCueMessage>;
    if (message.action !== "clientAckCue") {
      throw new WebSocketValidationError("action must be clientAckCue.");
    }
    const conversationId = requiredString(message.conversationId, "conversationId");
    if (conversationId !== connection.conversationId) {
      throw new WebSocketValidationError("conversationId must match the active WebSocket connection.");
    }

    return {
      conversationId,
      cueId: requiredString(message.cueId, "cueId"),
      acceptedAt: this.nowIso(),
    };
  }

  private async requireConnection(connectionId: string): Promise<WebSocketConnection> {
    const id = requiredString(connectionId, "connectionId");
    const connection = await this.store.getConnection(id);
    if (!connection) {
      throw new WebSocketConnectionNotFoundError(id);
    }
    return connection;
  }

  private nowIso(): string {
    return this.clock().toISOString();
  }
}

export function toWebSocketServiceError(error: unknown): WebSocketServiceError | ConversationServiceError {
  if (error instanceof WebSocketServiceError || error instanceof ConversationServiceError) {
    return error;
  }

  if (error instanceof InvalidConversationInputError) {
    return new WebSocketValidationError(error.message);
  }

  return new WebSocketServiceError("WEBSOCKET_INTERNAL_ERROR", "Unexpected WebSocket server error.", 500);
}
