import type { CueJob, CueJobQueue, StoredCueJob } from "./types.js";

function copyJob(job: StoredCueJob): StoredCueJob {
  return {
    ...job,
    reasons: [...job.reasons],
  };
}

export class InMemoryCueJobQueue implements CueJobQueue {
  private readonly jobs = new Map<string, StoredCueJob>();

  async enqueueCueJob(job: CueJob): Promise<StoredCueJob> {
    const existing = [...this.jobs.values()].find((candidate) => (
      candidate.conversationId === job.conversationId
      && candidate.triggerWindowId === job.triggerWindowId
      && candidate.status !== "FAILED"
    ));

    if (existing) {
      return copyJob(existing);
    }

    const stored: StoredCueJob = {
      ...job,
      reasons: [...job.reasons],
      status: "PENDING",
      attempts: 0,
    };
    this.jobs.set(stored.jobId, stored);
    return copyJob(stored);
  }

  async hasPendingCueJob(conversationId: string): Promise<boolean> {
    return [...this.jobs.values()].some((job) => (
      job.conversationId === conversationId
      && (job.status === "PENDING" || job.status === "IN_PROGRESS")
    ));
  }

  async receiveNextCueJob(): Promise<StoredCueJob | null> {
    const next = [...this.jobs.values()]
      .filter((job) => job.status === "PENDING")
      .sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt))[0];

    if (!next) return null;
    const updated: StoredCueJob = {
      ...next,
      reasons: [...next.reasons],
      status: "IN_PROGRESS",
      attempts: next.attempts + 1,
    };
    this.jobs.set(updated.jobId, updated);
    return copyJob(updated);
  }

  async completeCueJob(jobId: string): Promise<StoredCueJob | null> {
    const current = this.jobs.get(jobId);
    if (!current) return null;
    const updated: StoredCueJob = {
      ...current,
      reasons: [...current.reasons],
      status: "COMPLETED",
    };
    this.jobs.set(jobId, updated);
    return copyJob(updated);
  }

  async failCueJob(jobId: string, error: string): Promise<StoredCueJob | null> {
    const current = this.jobs.get(jobId);
    if (!current) return null;
    const updated: StoredCueJob = {
      ...current,
      reasons: [...current.reasons],
      status: "FAILED",
      lastError: error,
    };
    this.jobs.set(jobId, updated);
    return copyJob(updated);
  }

  listJobsForTest(): StoredCueJob[] {
    return [...this.jobs.values()]
      .sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt))
      .map(copyJob);
  }
}
