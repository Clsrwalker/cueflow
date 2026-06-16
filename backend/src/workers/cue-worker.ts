import type { Cue, TranscriptChunk } from "@cueflow/shared";
import { validateCueResult } from "@cueflow/shared";
import { MockAiProvider } from "../ai/mock-ai-provider.js";
import type { AiProvider } from "../ai/types.js";
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

  const startIndex = Math.max(0, endIndex - windowSize + 1);
  return chunks.slice(startIndex, endIndex + 1);
}

export class CueWorker {
  private readonly aiProvider: AiProvider;
  private readonly clock: Clock;
  private readonly idFactory: IdFactory;
  private readonly contextWindowSize: number;

  constructor(
    private readonly store: CueFlowStore,
    private readonly queue: CueJobQueue,
    private readonly messenger: WebSocketMessenger,
    options: CueWorkerOptions = {},
  ) {
    this.aiProvider = options.aiProvider ?? new MockAiProvider();
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? defaultIdFactory;
    this.contextWindowSize = options.contextWindowSize ?? 5;
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
      });
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
