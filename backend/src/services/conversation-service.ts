import { randomUUID } from "node:crypto";
import type { Conversation, ConversationSummary, Cue, CueType, TranscriptChunk } from "@cueflow/shared";
import type { AiProvider, SummaryProviderResult } from "../ai/types.js";
import { MockAiProvider } from "../ai/mock-ai-provider.js";
import type { CueFlowStore } from "../storage/types.js";

export const DEFAULT_USER_ID = "demo-user";

type Clock = () => Date;
type IdFactory = () => string;

export type ConversationServiceOptions = {
  clock?: Clock;
  idFactory?: IdFactory;
  aiProvider?: AiProvider;
};

export type CreateConversationInput = {
  userId?: string;
};

export type ListConversationsInput = {
  userId?: string;
};

export type AppendTranscriptChunkInput = {
  conversationId: string;
  chunkId?: string;
  speaker: string;
  text: string;
  clientTimestamp?: string;
};

export type RecordCueInput = {
  conversationId: string;
  cueId?: string;
  type: CueType;
  title: string;
  shortText: string;
  detailText: string;
  sourceChunkStart: string;
  sourceChunkEnd: string;
  confidence: number;
  modelLatencyMs?: number;
};

export type EndConversationResult = {
  conversation: Conversation;
  summary: ConversationSummary;
};

export class ConversationServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "ConversationServiceError";
  }
}

export class ConversationNotFoundError extends ConversationServiceError {
  constructor(conversationId: string) {
    super("CONVERSATION_NOT_FOUND", `Conversation ${conversationId} was not found.`, 404);
  }
}

export class InvalidConversationInputError extends ConversationServiceError {
  constructor(message: string) {
    super("INVALID_INPUT", message, 400);
  }
}

export class ConversationClosedError extends ConversationServiceError {
  constructor(conversationId: string) {
    super("CONVERSATION_CLOSED", `Conversation ${conversationId} has already ended.`, 409);
  }
}

export class SummaryNotReadyError extends ConversationServiceError {
  constructor(conversationId: string) {
    super("SUMMARY_NOT_READY", `Summary for conversation ${conversationId} is not ready.`, 404);
  }
}

function defaultIdFactory(): string {
  return randomUUID();
}

function normalizeRequiredString(value: string | undefined, field: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new InvalidConversationInputError(`${field} is required.`);
  }
  return trimmed;
}

function normalizeOptionalUserId(userId: string | undefined): string {
  const trimmed = userId?.trim();
  return trimmed || DEFAULT_USER_ID;
}

function conversationIdFrom(factory: IdFactory): string {
  return `conv_${factory()}`;
}

function generatedChunkId(factory: IdFactory): string {
  return `chunk_${factory()}`;
}

function generatedCueId(factory: IdFactory): string {
  return `cue_${factory()}`;
}

export class ConversationService {
  private readonly clock: Clock;
  private readonly idFactory: IdFactory;
  private readonly aiProvider: AiProvider;

  constructor(
    private readonly store: CueFlowStore,
    options: ConversationServiceOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? defaultIdFactory;
    this.aiProvider = options.aiProvider ?? new MockAiProvider();
  }

  async createConversation(input: CreateConversationInput = {}): Promise<Conversation> {
    const startedAt = this.nowIso();
    const conversation: Conversation = {
      conversationId: conversationIdFrom(this.idFactory),
      userId: normalizeOptionalUserId(input.userId),
      status: "ACTIVE",
      startedAt,
      endedAt: null,
      cueCount: 0,
      summaryStatus: "NOT_STARTED",
    };

    return this.store.createConversation(conversation);
  }

  async listConversations(input: ListConversationsInput = {}): Promise<Conversation[]> {
    return this.store.listConversations(normalizeOptionalUserId(input.userId));
  }

  async getConversation(conversationId: string): Promise<Conversation> {
    const id = normalizeRequiredString(conversationId, "conversationId");
    const conversation = await this.store.getConversation(id);
    if (!conversation) {
      throw new ConversationNotFoundError(id);
    }
    return conversation;
  }

  async appendTranscriptChunk(input: AppendTranscriptChunkInput): Promise<TranscriptChunk> {
    const conversation = await this.getConversation(input.conversationId);
    if (conversation.status === "ENDED") {
      throw new ConversationClosedError(conversation.conversationId);
    }

    const chunk: TranscriptChunk = {
      conversationId: conversation.conversationId,
      chunkId: normalizeRequiredString(input.chunkId ?? generatedChunkId(this.idFactory), "chunkId"),
      speaker: normalizeRequiredString(input.speaker, "speaker"),
      text: normalizeRequiredString(input.text, "text"),
      clientTimestamp: input.clientTimestamp?.trim() || this.nowIso(),
      createdAt: this.nowIso(),
    };

    const s3Key = await this.store.putRawTranscriptChunk(chunk);
    return this.store.putTranscriptChunk({ ...chunk, s3Key });
  }

  async recordCue(input: RecordCueInput): Promise<Cue> {
    await this.getConversation(input.conversationId);

    const cue: Cue = {
      conversationId: input.conversationId,
      cueId: normalizeRequiredString(input.cueId ?? generatedCueId(this.idFactory), "cueId"),
      type: input.type,
      title: normalizeRequiredString(input.title, "title"),
      shortText: normalizeRequiredString(input.shortText, "shortText"),
      detailText: normalizeRequiredString(input.detailText, "detailText"),
      sourceChunkStart: normalizeRequiredString(input.sourceChunkStart, "sourceChunkStart"),
      sourceChunkEnd: normalizeRequiredString(input.sourceChunkEnd, "sourceChunkEnd"),
      confidence: input.confidence,
      createdAt: this.nowIso(),
      modelLatencyMs: input.modelLatencyMs,
    };

    return this.store.putCue(cue);
  }

  async listCues(conversationId: string): Promise<Cue[]> {
    const conversation = await this.getConversation(conversationId);
    return this.store.listCues(conversation.conversationId);
  }

  async endConversation(conversationId: string): Promise<EndConversationResult> {
    const conversation = await this.getConversation(conversationId);
    const endedAt = conversation.endedAt ?? this.nowIso();
    const pending = await this.store.updateConversation(conversation.conversationId, {
      status: "ENDED",
      endedAt,
      summaryStatus: "PENDING",
    });

    if (!pending) {
      throw new ConversationNotFoundError(conversation.conversationId);
    }

    const chunks = await this.store.listTranscriptChunks(conversation.conversationId);
    await this.store.putFullTranscript(conversation.conversationId, chunks);

    const generated = await this.generateSummary(conversation.conversationId, chunks);
    const summary: ConversationSummary = {
      conversationId: conversation.conversationId,
      ...generated,
      createdAt: this.nowIso(),
    };

    await this.store.putSummary(summary);
    const updated = await this.store.updateConversation(conversation.conversationId, {
      summaryStatus: "READY",
    });

    if (!updated) {
      throw new ConversationNotFoundError(conversation.conversationId);
    }

    return {
      conversation: updated,
      summary,
    };
  }

  async getSummary(conversationId: string): Promise<ConversationSummary> {
    const conversation = await this.getConversation(conversationId);
    const summary = await this.store.getSummary(conversation.conversationId);
    if (!summary) {
      throw new SummaryNotReadyError(conversation.conversationId);
    }
    return summary;
  }

  private nowIso(): string {
    return this.clock().toISOString();
  }

  private async generateSummary(conversationId: string, chunks: TranscriptChunk[]): Promise<SummaryProviderResult> {
    try {
      return await this.aiProvider.generateSummary(chunks);
    } catch (error) {
      await this.store.updateConversation(conversationId, {
        summaryStatus: "FAILED",
      });
      throw error;
    }
  }
}
