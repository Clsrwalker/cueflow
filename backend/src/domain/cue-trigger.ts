import type { TranscriptChunk } from "@cueflow/shared";

export const TRIGGER_WORD_THRESHOLD = 60;
export const TRIGGER_COOLDOWN_MS = 8_000;
export const TRIGGER_QUESTION_COOLDOWN_MS = 1_500;
export const TRIGGER_AI_REVIEW_COOLDOWN_MS = 2_500;
export const TRIGGER_AI_REVIEW_MIN_WORDS = 3;
export const TRIGGER_MIN_WORDS_AFTER_COOLDOWN = 8;
export const TRIGGER_MAX_CUES_PER_MINUTE = 8;

export const DECISION_AND_RISK_KEYWORDS = [
  "choose",
  "compare",
  "trade-off",
  "tradeoff",
  "should we",
  "should i",
  "recommend",
  "suggest",
  "next step",
  "action item",
  "confidence threshold",
  "duplicate",
  "explain",
  "risk",
  "fail",
  "fails",
  "issue",
  "problem",
  "alternative",
  "persist",
  "data loss",
  "latency",
  "failure",
  "cost",
  "security",
  "reliability",
  "\u95EE\u9898",
  "\u98CE\u9669",
  "\u5E94\u8BE5",
  "\u9009\u62E9",
  "\u5EFA\u8BAE",
  "\u4E0B\u4E00\u6B65",
  "\u600E\u4E48",
  "\u5982\u4F55",
  "\u5931\u8D25",
  "\u6210\u672C",
  "\u5B89\u5168",
  "\u53EF\u9760",
  "\u65B9\u6848",
  "\u66FF\u4EE3",
] as const;

const LIVE_INTENT_KEYWORDS = [
  "question",
  "stuck",
  "confused",
  "explain",
  "clarify",
  "help",
  "how do",
  "how should",
  "what should",
  "why does",
  "\u95EE\u9898",
  "\u98CE\u9669",
  "\u5E94\u8BE5",
  "\u9009\u62E9",
  "\u5EFA\u8BAE",
  "\u4E0B\u4E00\u6B65",
  "\u600E\u4E48",
  "\u5982\u4F55",
  "\u4E3A\u4EC0\u4E48",
  "\u89E3\u91CA",
  "\u53EF\u4EE5\u5417",
  "\u80FD\u4E0D\u80FD",
] as const;

export type CueTriggerReason = "WORD_THRESHOLD" | "TIME_THRESHOLD" | "QUESTION" | "KEYWORD" | "AI_REVIEW";
export type CueSuppressionReason = "AUTO_CUE_OFF" | "PENDING_JOB" | "EMPTY_TEXT" | "COOLDOWN" | "RATE_LIMITED" | "LOW_SIGNAL";

export type CueTriggerInput = {
  conversationId: string;
  chunksSinceLastCue: TranscriptChunk[];
  lastCueCreatedAt?: string | null;
  recentCueCreatedAts?: string[];
  now?: string | Date;
  pendingCueJob?: boolean;
  autoCue?: boolean;
  maxCuesPerMinute?: number;
};

export type CueTriggerEvaluation = {
  shouldEnqueue: boolean;
  reasons: CueTriggerReason[];
  wordCount: number;
  sourceChunkStart: string | null;
  sourceChunkEnd: string | null;
  triggerWindowId: string | null;
  suppressionReason: CueSuppressionReason | null;
  cooldownRemainingMs: number;
};

function joinedText(chunks: TranscriptChunk[]): string {
  return chunks.map((chunk) => chunk.text).join(" ").trim();
}

function wordCount(value: string): number {
  const words = value.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?/g);
  const cjkChars = value.match(/[\u3400-\u9fff]/g);
  return (words?.length ?? 0) + Math.ceil((cjkChars?.length ?? 0) / 2);
}

function nowTimeMs(input: CueTriggerInput): number {
  const nowTime = input.now instanceof Date
    ? input.now.getTime()
    : Date.parse(input.now ?? new Date().toISOString());
  return Number.isFinite(nowTime) ? nowTime : Date.now();
}

function elapsedSinceLastCueMs(input: CueTriggerInput): number | null {
  if (!input.lastCueCreatedAt) return null;
  const lastCueTime = Date.parse(input.lastCueCreatedAt);
  if (!Number.isFinite(lastCueTime)) return null;
  return Math.max(0, nowTimeMs(input) - lastCueTime);
}

function hasQuestion(text: string): boolean {
  return /[?\uFF1F]/.test(text);
}

function hasSpokenQuestion(text: string): boolean {
  return /\b(what|why|how|when|where|who|which|what about|do you think|tell me|help me)\b/i.test(text)
    || /\b(can|could|would|should)\s+(we|i|you|this|that|it|there|the|our)\b/i.test(text)
    || /\b(do we|does this|is this|are we|is there|are there)\b/i.test(text)
    || /(\u4EC0\u4E48|\u4E3A\u4EC0\u4E48|\u600E\u4E48|\u5982\u4F55|\u662F\u5426|\u662F\u4E0D\u662F|\u6709\u6CA1\u6709|\u80FD\u4E0D\u80FD|\u80FD\u5426|\u53EF\u4EE5\u5417|\u53EF\u4E0D\u53EF\u4EE5|\u8981\u4E0D\u8981|\u54EA\u4E00\u4E2A|\u54EA\u91CC|\u95EE\u9898\u5728\u54EA|\u5E94\u8BE5\u600E\u4E48|\u6709\u4EC0\u4E48)/.test(text);
}

function hasLiveIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return /[?\uFF1F]/.test(text)
    || LIVE_INTENT_KEYWORDS.some((keyword) => lower.includes(keyword.toLowerCase()));
}

function hasDecisionOrRiskKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return DECISION_AND_RISK_KEYWORDS.some((keyword) => lower.includes(keyword))
    || LIVE_INTENT_KEYWORDS.some((keyword) => lower.includes(keyword.toLowerCase()));
}

function isLowValueAudioCheck(text: string, count: number): boolean {
  if (count > 14) return false;
  return /\b(can you hear me|hear me okay|can you see|microphone|mic check|audio check|testing|hello|hi)\b/i.test(text)
    && !hasDecisionOrRiskKeyword(text);
}

function isLowValueFiller(text: string, count: number): boolean {
  if (hasLiveIntent(text) || hasDecisionOrRiskKeyword(text)) return false;
  if (count > 5) return false;
  return /\b(okay|ok|sounds good|that sounds good|sure|yeah|yes|no|thanks|thank you|got it|right|fine|cool|great)\b/i.test(text);
}

function shouldAskAiToReview(text: string, count: number): boolean {
  if (count < TRIGGER_AI_REVIEW_MIN_WORDS) return false;
  return /\p{L}|\p{N}/u.test(text);
}

function recentCueCount(input: CueTriggerInput): number {
  const now = nowTimeMs(input);
  const candidates = input.recentCueCreatedAts?.length
    ? input.recentCueCreatedAts
    : input.lastCueCreatedAt
      ? [input.lastCueCreatedAt]
      : [];
  return candidates.filter((createdAt) => {
    const time = Date.parse(createdAt);
    return Number.isFinite(time) && now - time >= 0 && now - time < 60_000;
  }).length;
}

function triggerWindowId(input: CueTriggerInput, start: string | null, end: string | null, count: number): string | null {
  return start && end ? `${input.conversationId}:${start}:${end}:${count}` : null;
}

function suppressed(
  reason: CueSuppressionReason,
  partial: Omit<CueTriggerEvaluation, "shouldEnqueue" | "suppressionReason" | "cooldownRemainingMs">,
  cooldownRemainingMs = 0,
): CueTriggerEvaluation {
  return {
    ...partial,
    shouldEnqueue: false,
    suppressionReason: reason,
    cooldownRemainingMs,
  };
}

export function evaluateCueTrigger(input: CueTriggerInput): CueTriggerEvaluation {
  const chunks = input.chunksSinceLastCue;
  const text = joinedText(chunks);
  const recentText = chunks[chunks.length - 1]?.text.trim() || text;
  const count = wordCount(text);
  const sourceChunks = chunks.slice(-3);
  const sourceChunkStart = sourceChunks[0]?.chunkId ?? null;
  const sourceChunkEnd = sourceChunks[sourceChunks.length - 1]?.chunkId ?? null;
  const base = {
    reasons: [] as CueTriggerReason[],
    wordCount: count,
    sourceChunkStart,
    sourceChunkEnd,
    triggerWindowId: null,
  };

  if (input.autoCue === false) {
    return suppressed("AUTO_CUE_OFF", base);
  }

  if (input.pendingCueJob) {
    return suppressed("PENDING_JOB", base);
  }

  if (!chunks.length || !text) {
    return suppressed("EMPTY_TEXT", base);
  }

  if (isLowValueAudioCheck(recentText || text, count) || isLowValueFiller(recentText || text, wordCount(recentText || text))) {
    return suppressed("LOW_SIGNAL", base);
  }

  const maxCuesPerMinute = input.maxCuesPerMinute ?? TRIGGER_MAX_CUES_PER_MINUTE;
  if (maxCuesPerMinute > 0 && recentCueCount(input) >= maxCuesPerMinute) {
    return suppressed("RATE_LIMITED", base);
  }

  const reasons: CueTriggerReason[] = [];
  if (count > TRIGGER_WORD_THRESHOLD) reasons.push("WORD_THRESHOLD");
  const elapsedMs = elapsedSinceLastCueMs(input);
  if (elapsedMs !== null && elapsedMs > TRIGGER_COOLDOWN_MS && count >= TRIGGER_MIN_WORDS_AFTER_COOLDOWN) {
    reasons.push("TIME_THRESHOLD");
  }
  if (hasQuestion(recentText) || hasSpokenQuestion(recentText) || hasLiveIntent(recentText)) reasons.push("QUESTION");
  if (hasDecisionOrRiskKeyword(recentText)) reasons.push("KEYWORD");
  if (!reasons.length && shouldAskAiToReview(recentText, wordCount(recentText))) {
    reasons.push("AI_REVIEW");
  }

  if (!reasons.length) {
    return suppressed("LOW_SIGNAL", { ...base, reasons });
  }

  const cooldownMs = reasons.includes("QUESTION")
    ? TRIGGER_QUESTION_COOLDOWN_MS
    : reasons.includes("AI_REVIEW")
      ? TRIGGER_AI_REVIEW_COOLDOWN_MS
      : TRIGGER_COOLDOWN_MS;
  if (elapsedMs !== null && elapsedMs < cooldownMs) {
    return suppressed("COOLDOWN", { ...base, reasons }, cooldownMs - elapsedMs);
  }

  return {
    shouldEnqueue: true,
    reasons,
    wordCount: count,
    sourceChunkStart,
    sourceChunkEnd,
    triggerWindowId: triggerWindowId(input, sourceChunkStart, sourceChunkEnd, count),
    suppressionReason: null,
    cooldownRemainingMs: 0,
  };
}
