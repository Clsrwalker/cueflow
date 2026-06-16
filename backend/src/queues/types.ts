import type { CueTriggerReason } from "../domain/cue-trigger.js";

export type CueJobStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
export type SummaryJobStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

export type CueJob = {
  jobId: string;
  conversationId: string;
  triggerWindowId: string;
  sourceChunkStart: string;
  sourceChunkEnd: string;
  reasons: CueTriggerReason[];
  wordCount: number;
  enqueuedAt: string;
};

export type StoredCueJob = CueJob & {
  status: CueJobStatus;
  attempts: number;
  lastError?: string;
};

export type CueJobQueue = {
  enqueueCueJob(job: CueJob): Promise<StoredCueJob>;
  hasPendingCueJob(conversationId: string): Promise<boolean>;
  receiveNextCueJob(): Promise<StoredCueJob | null>;
  completeCueJob(jobId: string): Promise<StoredCueJob | null>;
  failCueJob(jobId: string, error: string): Promise<StoredCueJob | null>;
};

export type SummaryJob = {
  jobId: string;
  conversationId: string;
  enqueuedAt: string;
};

export type StoredSummaryJob = SummaryJob & {
  status: SummaryJobStatus;
  attempts: number;
  lastError?: string;
};

export type SummaryJobQueue = {
  enqueueSummaryJob(job: SummaryJob): Promise<StoredSummaryJob>;
  hasPendingSummaryJob(conversationId: string): Promise<boolean>;
  receiveNextSummaryJob(): Promise<StoredSummaryJob | null>;
  completeSummaryJob(jobId: string): Promise<StoredSummaryJob | null>;
  failSummaryJob(jobId: string, error: string): Promise<StoredSummaryJob | null>;
};
