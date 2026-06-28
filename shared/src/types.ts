export const CUE_TYPES = ["CONCEPT", "DECISION", "RISK", "ACTION", "SUMMARY"] as const;
export type CueType = (typeof CUE_TYPES)[number];

export type ConversationStatus = "ACTIVE" | "ENDED";
export type SummaryStatus = "NOT_STARTED" | "PENDING" | "READY" | "FAILED";

export type Conversation = {
  conversationId: string;
  userId: string;
  status: ConversationStatus;
  startedAt: string;
  endedAt?: string | null;
  cueCount: number;
  summaryStatus: SummaryStatus;
};

export type TranscriptChunk = {
  conversationId: string;
  chunkId: string;
  speaker: string;
  text: string;
  clientTimestamp?: string;
  createdAt: string;
  s3Key?: string;
};

export type Cue = {
  cueId: string;
  conversationId: string;
  type: CueType;
  title: string;
  shortText: string;
  detailText: string;
  sourceChunkStart: string;
  sourceChunkEnd: string;
  confidence: number;
  createdAt: string;
  modelLatencyMs?: number;
};

export type ConversationSummary = {
  conversationId: string;
  summary: string;
  keyTopics: string[];
  actionItems: string[];
  risks: string[];
  createdAt: string;
};

export type WebSocketConnection = {
  connectionId: string;
  conversationId: string;
  userId: string;
  connectedAt: string;
  ttl?: number;
};

export type WebSocketSendTranscriptMessage = {
  action: "sendTranscript";
  conversationId: string;
  chunkId: string;
  speaker: string;
  text: string;
  clientTimestamp: string;
  promptContext?: string;
};

export type WebSocketPingMessage = {
  action: "ping";
};

export type WebSocketClientAckCueMessage = {
  action: "clientAckCue";
  conversationId: string;
  cueId: string;
};

export type TranscriptAckEvent = {
  eventType: "transcript.ack";
  conversationId: string;
  chunkId: string;
  receivedAt: string;
};

export type PongEvent = {
  eventType: "pong";
  receivedAt: string;
};

export type CueCreatedEvent = {
  eventType: "cue.created";
  conversationId: string;
  cue: Pick<Cue, "cueId" | "type" | "title" | "shortText" | "detailText">;
};

export type SummaryReadyEvent = {
  eventType: "summary.ready";
  conversationId: string;
  summaryStatus: "READY";
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };
