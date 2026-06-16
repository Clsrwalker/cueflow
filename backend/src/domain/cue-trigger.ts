import type { TranscriptChunk } from "@cueflow/shared";

export const TRIGGER_WORD_THRESHOLD = 60;
export const TRIGGER_COOLDOWN_MS = 20_000;

export const DECISION_AND_RISK_KEYWORDS = [
  "choose",
  "compare",
  "trade-off",
  "tradeoff",
  "should we",
  "risk",
  "issue",
  "problem",
  "alternative",
  "latency",
  "failure",
  "cost",
  "security",
  "reliability",
] as const;

export type CueTriggerReason = "WORD_THRESHOLD" | "TIME_THRESHOLD" | "QUESTION" | "KEYWORD";

export type CueTriggerInput = {
  conversationId: string;
  chunksSinceLastCue: TranscriptChunk[];
  lastCueCreatedAt?: string | null;
  now?: string | Date;
  pendingCueJob?: boolean;
};

export type CueTriggerEvaluation = {
  shouldEnqueue: boolean;
  reasons: CueTriggerReason[];
  wordCount: number;
  sourceChunkStart: string | null;
  sourceChunkEnd: string | null;
  triggerWindowId: string | null;
};

function joinedText(chunks: TranscriptChunk[]): string {
  return chunks.map((chunk) => chunk.text).join(" ").trim();
}

function wordCount(value: string): number {
  const words = value.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?/g);
  return words?.length ?? 0;
}

function elapsedSinceLastCueMs(input: CueTriggerInput): number | null {
  if (!input.lastCueCreatedAt) return null;
  const lastCueTime = Date.parse(input.lastCueCreatedAt);
  const nowTime = input.now instanceof Date
    ? input.now.getTime()
    : Date.parse(input.now ?? new Date().toISOString());
  if (!Number.isFinite(lastCueTime) || !Number.isFinite(nowTime)) return null;
  return Math.max(0, nowTime - lastCueTime);
}

function hasQuestion(text: string): boolean {
  return /[?？]/.test(text);
}

function hasDecisionOrRiskKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return DECISION_AND_RISK_KEYWORDS.some((keyword) => lower.includes(keyword));
}

export function evaluateCueTrigger(input: CueTriggerInput): CueTriggerEvaluation {
  const chunks = input.chunksSinceLastCue;
  const text = joinedText(chunks);
  const count = wordCount(text);
  const sourceChunkStart = chunks[0]?.chunkId ?? null;
  const sourceChunkEnd = chunks[chunks.length - 1]?.chunkId ?? null;

  if (input.pendingCueJob || !chunks.length || !text) {
    return {
      shouldEnqueue: false,
      reasons: [],
      wordCount: count,
      sourceChunkStart,
      sourceChunkEnd,
      triggerWindowId: null,
    };
  }

  const reasons: CueTriggerReason[] = [];
  if (count > TRIGGER_WORD_THRESHOLD) reasons.push("WORD_THRESHOLD");
  const elapsedMs = elapsedSinceLastCueMs(input);
  if (elapsedMs !== null && elapsedMs > TRIGGER_COOLDOWN_MS) reasons.push("TIME_THRESHOLD");
  if (hasQuestion(text)) reasons.push("QUESTION");
  if (hasDecisionOrRiskKeyword(text)) reasons.push("KEYWORD");

  const shouldEnqueue = reasons.length > 0;
  return {
    shouldEnqueue,
    reasons,
    wordCount: count,
    sourceChunkStart,
    sourceChunkEnd,
    triggerWindowId: shouldEnqueue && sourceChunkStart && sourceChunkEnd
      ? `${input.conversationId}:${sourceChunkStart}:${sourceChunkEnd}:${count}`
      : null,
  };
}

