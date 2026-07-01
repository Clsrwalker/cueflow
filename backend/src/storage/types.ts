import type { Conversation, ConversationSummary, Cue, TranscriptChunk, UsedPrenote, WebSocketConnection } from "@cueflow/shared";

export type ConversationPatch = Partial<Pick<Conversation, "status" | "endedAt" | "cueCount" | "summaryStatus">> & {
  usedPrenote?: UsedPrenote;
};

export type MetadataStore = {
  createConversation(conversation: Conversation): Promise<Conversation>;
  listConversations(userId: string): Promise<Conversation[]>;
  getConversation(conversationId: string): Promise<Conversation | null>;
  updateConversation(conversationId: string, patch: ConversationPatch): Promise<Conversation | null>;
  putTranscriptChunk(chunk: TranscriptChunk): Promise<TranscriptChunk>;
  listTranscriptChunks(conversationId: string): Promise<TranscriptChunk[]>;
  putCue(cue: Cue): Promise<Cue>;
  listCues(conversationId: string): Promise<Cue[]>;
  putConnection(connection: WebSocketConnection): Promise<WebSocketConnection>;
  getConnection(connectionId: string): Promise<WebSocketConnection | null>;
  deleteConnection(connectionId: string): Promise<WebSocketConnection | null>;
  listConnections(conversationId: string): Promise<WebSocketConnection[]>;
};

export type ObjectStore = {
  putRawTranscriptChunk(chunk: TranscriptChunk): Promise<string>;
  putFullTranscript(conversationId: string, chunks: TranscriptChunk[]): Promise<string>;
  putSummary(summary: ConversationSummary): Promise<string>;
  getSummary(conversationId: string): Promise<ConversationSummary | null>;
};

export type CueFlowStore = MetadataStore & ObjectStore;
