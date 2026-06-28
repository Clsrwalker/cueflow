import type { ConversationSummary, Cue, TranscriptChunk } from "@cueflow/shared";

export type CueContextWindow = {
  conversationId: string;
  chunks: TranscriptChunk[];
  promptContext?: string;
  now?: string;
};

export type CueProviderResult = Pick<
  Cue,
  "type" | "title" | "shortText" | "detailText" | "sourceChunkStart" | "sourceChunkEnd" | "confidence"
>;

export type SummaryProviderResult = Omit<ConversationSummary, "conversationId" | "createdAt">;

export type SummaryProviderOptions = {
  promptContext?: string;
};

export type AiProvider = {
  generateCue(contextWindow: CueContextWindow): Promise<CueProviderResult>;
  generateSummary(fullTranscript: TranscriptChunk[], options?: SummaryProviderOptions): Promise<SummaryProviderResult>;
};
