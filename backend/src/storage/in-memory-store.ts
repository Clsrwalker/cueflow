import type { Conversation, ConversationSummary, Cue, TranscriptChunk } from "@cueflow/shared";
import {
  fullTranscriptS3Key,
  rawChunkS3Key,
  summaryS3Key,
} from "@cueflow/shared";
import type { ConversationPatch, CueFlowStore } from "./types.js";

type StoredObject = {
  key: string;
  body: unknown;
};

export class InMemoryCueFlowStore implements CueFlowStore {
  private readonly conversations = new Map<string, Conversation>();
  private readonly chunksByConversation = new Map<string, TranscriptChunk[]>();
  private readonly cuesByConversation = new Map<string, Cue[]>();
  private readonly summaries = new Map<string, ConversationSummary>();
  private readonly objects = new Map<string, StoredObject>();

  async createConversation(conversation: Conversation): Promise<Conversation> {
    const copy = { ...conversation };
    this.conversations.set(copy.conversationId, copy);
    return { ...copy };
  }

  async listConversations(userId: string): Promise<Conversation[]> {
    return [...this.conversations.values()]
      .filter((conversation) => conversation.userId === userId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map((conversation) => ({ ...conversation }));
  }

  async getConversation(conversationId: string): Promise<Conversation | null> {
    const conversation = this.conversations.get(conversationId);
    return conversation ? { ...conversation } : null;
  }

  async updateConversation(conversationId: string, patch: ConversationPatch): Promise<Conversation | null> {
    const current = this.conversations.get(conversationId);
    if (!current) return null;
    const next = { ...current, ...patch };
    this.conversations.set(conversationId, next);
    return { ...next };
  }

  async putTranscriptChunk(chunk: TranscriptChunk): Promise<TranscriptChunk> {
    const current = this.chunksByConversation.get(chunk.conversationId) ?? [];
    const withoutDuplicate = current.filter((item) => item.chunkId !== chunk.chunkId);
    const nextChunk = { ...chunk, s3Key: chunk.s3Key ?? rawChunkS3Key(chunk.conversationId, chunk.chunkId) };
    const next = [...withoutDuplicate, nextChunk].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    this.chunksByConversation.set(chunk.conversationId, next);
    return { ...nextChunk };
  }

  async listTranscriptChunks(conversationId: string): Promise<TranscriptChunk[]> {
    return (this.chunksByConversation.get(conversationId) ?? []).map((chunk) => ({ ...chunk }));
  }

  async putCue(cue: Cue): Promise<Cue> {
    const current = this.cuesByConversation.get(cue.conversationId) ?? [];
    const withoutDuplicate = current.filter((item) => item.cueId !== cue.cueId);
    const next = [...withoutDuplicate, { ...cue }].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    this.cuesByConversation.set(cue.conversationId, next);

    const conversation = this.conversations.get(cue.conversationId);
    if (conversation) {
      this.conversations.set(cue.conversationId, {
        ...conversation,
        cueCount: next.length,
      });
    }

    return { ...cue };
  }

  async listCues(conversationId: string): Promise<Cue[]> {
    return (this.cuesByConversation.get(conversationId) ?? []).map((cue) => ({ ...cue }));
  }

  async putRawTranscriptChunk(chunk: TranscriptChunk): Promise<string> {
    const key = rawChunkS3Key(chunk.conversationId, chunk.chunkId);
    this.objects.set(key, {
      key,
      body: { ...chunk },
    });
    return key;
  }

  async putFullTranscript(conversationId: string, chunks: TranscriptChunk[]): Promise<string> {
    const key = fullTranscriptS3Key(conversationId);
    this.objects.set(key, {
      key,
      body: chunks.map((chunk) => ({ ...chunk })),
    });
    return key;
  }

  async putSummary(summary: ConversationSummary): Promise<string> {
    const key = summaryS3Key(summary.conversationId);
    const copy = {
      ...summary,
      keyTopics: [...summary.keyTopics],
      actionItems: [...summary.actionItems],
      risks: [...summary.risks],
    };
    this.summaries.set(summary.conversationId, copy);
    this.objects.set(key, {
      key,
      body: copy,
    });
    return key;
  }

  async getSummary(conversationId: string): Promise<ConversationSummary | null> {
    const summary = this.summaries.get(conversationId);
    return summary
      ? {
          ...summary,
          keyTopics: [...summary.keyTopics],
          actionItems: [...summary.actionItems],
          risks: [...summary.risks],
        }
      : null;
  }

  getObjectForTest(key: string): StoredObject | null {
    return this.objects.get(key) ?? null;
  }
}

