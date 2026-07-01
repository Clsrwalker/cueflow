import type { Cue, TranscriptChunk } from "@cueflow/shared";
import { validateCueResult } from "@cueflow/shared";
import type { AiProvider } from "../ai/types.js";
import { createAiProviderFromEnv } from "../ai/provider-factory.js";
import type { CueJobQueue, StoredCueJob } from "../queues/types.js";
import type { CueFlowStore } from "../storage/types.js";
import type { WebSocketMessenger } from "../websocket/messenger.js";
import { publishToConversationConnections } from "./event-publisher.js";

type Clock = () => Date;
type IdFactory = () => string;

export type CueWorkerOptions = {
  aiProvider?: AiProvider;
  clock?: Clock;
  idFactory?: IdFactory;
  contextWindowSize?: number;
  confidenceThreshold?: number;
  questionConfidenceThreshold?: number;
  aiReviewConfidenceThreshold?: number;
  duplicateLookback?: number;
};

export type CueWorkerResult =
  | { status: "NO_JOB" }
  | {
      status: "COMPLETED";
      job: StoredCueJob;
      cue: Cue;
      deliveredCount: number;
    }
  | {
      status: "SKIPPED";
      job: StoredCueJob;
      reason: string;
    }
  | {
      status: "FAILED";
      job: StoredCueJob;
      error: string;
    };

function defaultIdFactory(): string {
  return Math.random().toString(36).slice(2, 12);
}

function contextWindow(chunks: TranscriptChunk[], job: StoredCueJob, windowSize: number): TranscriptChunk[] {
  const endIndex = chunks.findIndex((chunk) => chunk.chunkId === job.sourceChunkEnd);
  if (endIndex < 0) {
    return chunks.slice(-windowSize);
  }

  const explicitStartIndex = chunks.findIndex((chunk) => chunk.chunkId === job.sourceChunkStart);
  if (explicitStartIndex >= 0 && explicitStartIndex <= endIndex) {
    return chunks.slice(explicitStartIndex, endIndex + 1).slice(-windowSize);
  }

  const fallbackStartIndex = Math.max(0, endIndex - windowSize + 1);
  return chunks.slice(fallbackStartIndex, endIndex + 1);
}

function cueContentKey(cue: Pick<Cue, "title" | "shortText" | "detailText">): string {
  return [cue.title, cue.shortText, cue.detailText]
    .join("\n")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cueTokens(cue: Pick<Cue, "title" | "shortText">): Set<string> {
  const stopWords = new Set(["the", "and", "for", "with", "use", "from", "that", "this", "into", "your", "you", "cue", "cues"]);
  const tokens = `${cue.title} ${cue.shortText}`
    .toLowerCase()
    .match(/[a-z0-9]+(?:-[a-z0-9]+)?/g) ?? [];
  return new Set(tokens.filter((token) => token.length > 2 && !stopWords.has(token)));
}

function tokenOverlap(
  leftCue: Pick<Cue, "title" | "shortText">,
  rightCue: Pick<Cue, "title" | "shortText">,
): number {
  const left = cueTokens(leftCue);
  const right = cueTokens(rightCue);
  const smaller = Math.min(left.size, right.size);
  if (!smaller) return 0;
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return shared / smaller;
}

function sharedAnchorCount(
  leftCue: Pick<Cue, "title" | "shortText">,
  rightCue: Pick<Cue, "title" | "shortText">,
): number {
  const anchors = [
    "websocket",
    "rest",
    "polling",
    "latency",
    "openai",
    "sqs",
    "worker",
    "lambda",
    "dynamodb",
    "s3",
    "summary",
    "confidence",
    "duplicate",
    "transcript",
  ];
  const left = cueTokens(leftCue);
  const right = cueTokens(rightCue);
  return anchors.filter((anchor) => left.has(anchor) && right.has(anchor)).length;
}

function sharesDuplicateAnchorPair(
  leftCue: Pick<Cue, "title" | "shortText">,
  rightCue: Pick<Cue, "title" | "shortText">,
): boolean {
  const left = cueTokens(leftCue);
  const right = cueTokens(rightCue);
  const pairs = [
    ["websocket", "rest"],
    ["confidence", "duplicate"],
    ["sqs", "worker"],
  ] as const;
  return pairs.some(([first, second]) => (
    left.has(first) && left.has(second) && right.has(first) && right.has(second)
  ));
}

function isDuplicateCue(
  candidate: Pick<Cue, "type" | "title" | "shortText" | "detailText">,
  existing: Cue[],
  lookback: number,
): boolean {
  const key = cueContentKey(candidate);
  if (!key) return false;
  return existing
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, lookback)
    .some((cue) => (
      cueContentKey(cue) === key
      || tokenOverlap(candidate, cue) >= 0.55
      || sharesDuplicateAnchorPair(candidate, cue)
      || (cue.type === candidate.type && sharedAnchorCount(candidate, cue) >= 2)
    ));
}

export class CueWorker {
  private readonly aiProvider: AiProvider;
  private readonly clock: Clock;
  private readonly idFactory: IdFactory;
  private readonly contextWindowSize: number;
  private readonly confidenceThreshold: number;
  private readonly questionConfidenceThreshold: number;
  private readonly aiReviewConfidenceThreshold: number;
  private readonly duplicateLookback: number;

  constructor(
    private readonly store: CueFlowStore,
    private readonly queue: CueJobQueue,
    private readonly messenger: WebSocketMessenger,
    options: CueWorkerOptions = {},
  ) {
    this.aiProvider = options.aiProvider ?? createAiProviderFromEnv();
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? defaultIdFactory;
    this.contextWindowSize = options.contextWindowSize ?? 5;
    this.confidenceThreshold = options.confidenceThreshold ?? Number(process.env.CUEFLOW_CUE_CONFIDENCE_THRESHOLD || 0.72);
    this.questionConfidenceThreshold = options.questionConfidenceThreshold
      ?? Number(process.env.CUEFLOW_QUESTION_CUE_CONFIDENCE_THRESHOLD || 0.55);
    this.aiReviewConfidenceThreshold = options.aiReviewConfidenceThreshold
      ?? Number(process.env.CUEFLOW_AI_REVIEW_CUE_CONFIDENCE_THRESHOLD || 0.6);
    this.duplicateLookback = options.duplicateLookback ?? Number(process.env.CUEFLOW_CUE_DUPLICATE_LOOKBACK || 10);
  }

  async processNext(): Promise<CueWorkerResult> {
    const job = await this.queue.receiveNextCueJob();
    if (!job) return { status: "NO_JOB" };
    return this.processJob(job);
  }

  async processJob(job: StoredCueJob): Promise<CueWorkerResult> {
    try {
      const startedAt = this.clock().getTime();
      const chunks = await this.store.listTranscriptChunks(job.conversationId);
      const cueContext = contextWindow(chunks, job, this.contextWindowSize);
      const generated = await this.aiProvider.generateCue({
        conversationId: job.conversationId,
        chunks: cueContext,
        promptContext: job.promptContext,
      });

      if (generated.display === false) {
        const completed = await this.queue.completeCueJob(job.jobId);
        return {
          status: "SKIPPED",
          job: completed ?? job,
          reason: generated.skipReason,
        };
      }

      const confidenceThreshold = job.reasons.includes("QUESTION")
        ? Math.min(this.confidenceThreshold, this.questionConfidenceThreshold)
        : job.reasons.includes("AI_REVIEW")
          ? Math.min(this.confidenceThreshold, this.aiReviewConfidenceThreshold)
        : this.confidenceThreshold;
      if (generated.confidence < confidenceThreshold) {
        const completed = await this.queue.completeCueJob(job.jobId);
        return {
          status: "SKIPPED",
          job: completed ?? job,
          reason: `low_confidence:${generated.confidence.toFixed(2)}`,
        };
      }

      const existingCues = await this.store.listCues(job.conversationId);
      if (isDuplicateCue(generated, existingCues, this.duplicateLookback)) {
        const completed = await this.queue.completeCueJob(job.jobId);
        return {
          status: "SKIPPED",
          job: completed ?? job,
          reason: "duplicate_cue",
        };
      }

      const latencyMs = Math.max(0, this.clock().getTime() - startedAt);
      const cue: Cue = {
        cueId: `cue_${this.idFactory()}`,
        conversationId: job.conversationId,
        type: generated.type,
        title: generated.title,
        shortText: generated.shortText,
        detailText: generated.detailText,
        sourceChunkStart: generated.sourceChunkStart,
        sourceChunkEnd: generated.sourceChunkEnd,
        confidence: generated.confidence,
        createdAt: this.clock().toISOString(),
        modelLatencyMs: latencyMs,
      };

      const validation = validateCueResult(cue);
      if (!validation.ok) {
        throw new Error(validation.errors.join("; "));
      }

      const saved = await this.store.putCue(validation.value);
      const deliveredCount = await publishToConversationConnections(
        this.store,
        this.messenger,
        job.conversationId,
        {
          eventType: "cue.created",
          conversationId: job.conversationId,
          cue: {
            cueId: saved.cueId,
            type: saved.type,
            title: saved.title,
            shortText: saved.shortText,
            detailText: saved.detailText,
            sourceChunkStart: saved.sourceChunkStart,
            sourceChunkEnd: saved.sourceChunkEnd,
            confidence: saved.confidence,
            createdAt: saved.createdAt,
          },
        },
      );
      const completed = await this.queue.completeCueJob(job.jobId);

      return {
        status: "COMPLETED",
        job: completed ?? job,
        cue: saved,
        deliveredCount,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "cue worker failed";
      const failed = await this.queue.failCueJob(job.jobId, message);
      return {
        status: "FAILED",
        job: failed ?? job,
        error: message,
      };
    }
  }
}
