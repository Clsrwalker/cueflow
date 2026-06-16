import type { TranscriptChunk } from "@cueflow/shared";

export function chunk(overrides: Partial<TranscriptChunk> & { chunkId: string; text: string }): TranscriptChunk {
  return {
    conversationId: overrides.conversationId ?? "c_001",
    chunkId: overrides.chunkId,
    speaker: overrides.speaker ?? "speaker_1",
    text: overrides.text,
    clientTimestamp: overrides.clientTimestamp ?? "2026-06-16T10:00:00.000Z",
    createdAt: overrides.createdAt ?? `2026-06-16T10:00:${overrides.chunkId.padStart(2, "0")}.000Z`,
    s3Key: overrides.s3Key,
  };
}

