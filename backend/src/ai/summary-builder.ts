import type { TranscriptChunk } from "@cueflow/shared";
import type { SummaryProviderResult } from "./types.js";

export type SummaryBuilderResult = SummaryProviderResult;

const TOPIC_PATTERNS: Array<[string, RegExp]> = [
  ["WebSocket real-time delivery", /\b(websocket|server push|real[- ]time)\b/i],
  ["REST API lifecycle", /\b(rest|http api|history|summary retrieval)\b/i],
  ["SQS async processing", /\b(sqs|queue|async|worker)\b/i],
  ["DynamoDB metadata storage", /\b(dynamodb|metadata|connection state)\b/i],
  ["S3 transcript and summary storage", /\b(s3|raw transcript|object storage|summary object)\b/i],
  ["AI cue generation", /\b(ai|cue|model|llm)\b/i],
  ["Cloud reliability and latency", /\b(risk|failure|latency|reliability)\b/i],
];

function sentenceSplit(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function unique(values: string[], fallback: string[]): string[] {
  const seen = new Set<string>();
  const result = values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
  return result.length ? result : fallback;
}

export function buildSummaryFromTranscript(chunks: TranscriptChunk[]): SummaryBuilderResult {
  const ordered = [...chunks].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const text = ordered.map((chunk) => chunk.text.trim()).filter(Boolean).join(" ");
  const sentences = sentenceSplit(text);

  const keyTopics = unique(
    TOPIC_PATTERNS
      .filter(([, pattern]) => pattern.test(text))
      .map(([topic]) => topic),
    ["Conversation architecture"],
  );

  const actionItems = unique(
    sentences
      .filter((sentence) => /\b(todo|next|need to|should implement|should use|we should|must)\b/i.test(sentence))
      .map((sentence) => sentence.replace(/^maybe\s+/i, "").replace(/^we\s+/i, "We ")),
    ["Review generated cues and finalize the next implementation step."],
  );

  const risks = unique(
    sentences
      .filter((sentence) => /\b(risk|failure|latency|cost|security|reliability|uncertain|slow)\b/i.test(sentence)),
    ["No major risks were explicitly identified in the transcript."],
  );

  const summary = text
    ? `The conversation focused on ${keyTopics.slice(0, 3).join(", ")}. ${sentences[0] ?? ""}`.trim()
    : "The conversation did not contain enough transcript content for a detailed summary.";

  return {
    summary,
    keyTopics,
    actionItems,
    risks,
  };
}

