import type { StoredSummaryJob, SummaryJob, SummaryJobQueue } from "./types.js";

function copyJob(job: StoredSummaryJob): StoredSummaryJob {
  return { ...job };
}

export class InMemorySummaryJobQueue implements SummaryJobQueue {
  private readonly jobs = new Map<string, StoredSummaryJob>();

  async enqueueSummaryJob(job: SummaryJob): Promise<StoredSummaryJob> {
    const existing = [...this.jobs.values()].find((candidate) => (
      candidate.conversationId === job.conversationId
      && (candidate.status === "PENDING" || candidate.status === "IN_PROGRESS")
    ));

    if (existing) {
      return copyJob(existing);
    }

    const stored: StoredSummaryJob = {
      ...job,
      status: "PENDING",
      attempts: 0,
    };
    this.jobs.set(stored.jobId, stored);
    return copyJob(stored);
  }

  async hasPendingSummaryJob(conversationId: string): Promise<boolean> {
    return [...this.jobs.values()].some((job) => (
      job.conversationId === conversationId
      && (job.status === "PENDING" || job.status === "IN_PROGRESS")
    ));
  }

  async receiveNextSummaryJob(): Promise<StoredSummaryJob | null> {
    const next = [...this.jobs.values()]
      .filter((job) => job.status === "PENDING")
      .sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt))[0];

    if (!next) return null;
    const updated: StoredSummaryJob = {
      ...next,
      status: "IN_PROGRESS",
      attempts: next.attempts + 1,
    };
    this.jobs.set(updated.jobId, updated);
    return copyJob(updated);
  }

  async completeSummaryJob(jobId: string): Promise<StoredSummaryJob | null> {
    const current = this.jobs.get(jobId);
    if (!current) return null;
    const updated: StoredSummaryJob = {
      ...current,
      status: "COMPLETED",
    };
    this.jobs.set(jobId, updated);
    return copyJob(updated);
  }

  async failSummaryJob(jobId: string, error: string): Promise<StoredSummaryJob | null> {
    const current = this.jobs.get(jobId);
    if (!current) return null;
    const updated: StoredSummaryJob = {
      ...current,
      status: "FAILED",
      lastError: error,
    };
    this.jobs.set(jobId, updated);
    return copyJob(updated);
  }

  listJobsForTest(): StoredSummaryJob[] {
    return [...this.jobs.values()]
      .sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt))
      .map(copyJob);
  }
}
