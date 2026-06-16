import type { TranscriptChunk } from "@cueflow/shared";
import { buildSummaryFromTranscript } from "./summary-builder.js";
import type { AiProvider, CueContextWindow, CueProviderResult, SummaryProviderResult } from "./types.js";

function combinedText(chunks: TranscriptChunk[]): string {
  return chunks.map((chunk) => chunk.text).join(" ").trim();
}

function sourceStart(chunks: TranscriptChunk[]): string {
  return chunks[0]?.chunkId ?? "unknown";
}

function sourceEnd(chunks: TranscriptChunk[]): string {
  return chunks[chunks.length - 1]?.chunkId ?? sourceStart(chunks);
}

function cueBase(context: CueContextWindow): Pick<CueProviderResult, "sourceChunkStart" | "sourceChunkEnd" | "confidence"> {
  return {
    sourceChunkStart: sourceStart(context.chunks),
    sourceChunkEnd: sourceEnd(context.chunks),
    confidence: 0.86,
  };
}

export class MockAiProvider implements AiProvider {
  async generateCue(contextWindow: CueContextWindow): Promise<CueProviderResult> {
    const text = combinedText(contextWindow.chunks);
    const lower = text.toLowerCase();
    const base = cueBase(contextWindow);

    if (/\b(risk|failure|latency|cost|security|reliability|uncertain|slow)\b/.test(lower)) {
      return {
        ...base,
        type: "RISK",
        title: "Risk detected",
        shortText: "The conversation mentions reliability, cost, security, latency, or failure risk.",
        detailText: "CueFlow should preserve transcript chunks before AI processing and rely on queue retries so failures do not lose conversation data.",
      };
    }

    if (/\b(todo|next|need to|should implement|we should implement)\b/.test(lower)) {
      return {
        ...base,
        type: "ACTION",
        title: "Action item",
        shortText: "The discussion implies a concrete next step.",
        detailText: "Capture this item in the session summary so it remains visible after the live conversation ends.",
      };
    }

    if (/\b(summary|recap|end conversation|session end)\b/.test(lower)) {
      return {
        ...base,
        type: "SUMMARY",
        title: "Checkpoint summary",
        shortText: "The conversation is moving toward a recap or session close.",
        detailText: "CueFlow can generate a structured summary with key topics, action items, and risks after the session ends.",
      };
    }

    if (/\b(websocket|polling|rest|lambda|ecs|fargate|choose|compare|trade-off|tradeoff|alternative|should we)\b/.test(lower)) {
      return {
        ...base,
        type: "DECISION",
        title: "Architecture decision",
        shortText: "The transcript discusses alternatives or a cloud architecture choice.",
        detailText: "Use WebSocket for real-time cue delivery and REST for non-real-time history and summary retrieval.",
      };
    }

    if (/\b(sqs|queue|async|worker|dynamodb|s3|object storage)\b/.test(lower)) {
      return {
        ...base,
        type: "CONCEPT",
        title: "Cloud architecture concept",
        shortText: "The conversation introduces a cloud-native building block.",
        detailText: "CueFlow separates metadata, raw transcript objects, and async AI work so each tier has a clear responsibility.",
      };
    }

    return {
      ...base,
      type: "CONCEPT",
      title: "Context cue",
      shortText: "CueFlow detected useful context in the transcript.",
      detailText: "Keep the transcript flowing and wait for stronger decision, risk, or action signals before creating more cues.",
    };
  }

  async generateSummary(fullTranscript: TranscriptChunk[]): Promise<SummaryProviderResult> {
    return buildSummaryFromTranscript(fullTranscript);
  }
}

