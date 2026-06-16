import type { SummaryJobQueue, StoredSummaryJob } from "../queues/types.js";
import type { ConversationService, GenerateSummaryResult } from "../services/conversation-service.js";
import type { CueFlowStore } from "../storage/types.js";
import type { WebSocketMessenger } from "../websocket/messenger.js";
import { publishToConversationConnections } from "./event-publisher.js";

export type SummaryWorkerResult =
  | { status: "NO_JOB" }
  | {
      status: "COMPLETED";
      job: StoredSummaryJob;
      result: GenerateSummaryResult;
      deliveredCount: number;
    }
  | {
      status: "FAILED";
      job: StoredSummaryJob;
      error: string;
    };

export class SummaryWorker {
  constructor(
    private readonly conversations: ConversationService,
    private readonly store: CueFlowStore,
    private readonly queue: SummaryJobQueue,
    private readonly messenger: WebSocketMessenger,
  ) {}

  async processNext(): Promise<SummaryWorkerResult> {
    const job = await this.queue.receiveNextSummaryJob();
    if (!job) return { status: "NO_JOB" };
    return this.processJob(job);
  }

  async processJob(job: StoredSummaryJob): Promise<SummaryWorkerResult> {
    try {
      const result = await this.conversations.generateSummary(job.conversationId);
      const deliveredCount = await publishToConversationConnections(
        this.store,
        this.messenger,
        job.conversationId,
        {
          eventType: "summary.ready",
          conversationId: job.conversationId,
          summaryStatus: "READY",
        },
      );
      const completed = await this.queue.completeSummaryJob(job.jobId);
      return {
        status: "COMPLETED",
        job: completed ?? job,
        result,
        deliveredCount,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "summary worker failed";
      const failed = await this.queue.failSummaryJob(job.jobId, message);
      return {
        status: "FAILED",
        job: failed ?? job,
        error: message,
      };
    }
  }
}
