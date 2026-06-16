import { describe, expect, test } from "vitest";
import { InMemoryCueJobQueue } from "./in-memory-cue-job-queue.js";

describe("InMemoryCueJobQueue", () => {
  test("enqueues cue jobs idempotently by trigger window", async () => {
    const queue = new InMemoryCueJobQueue();

    const first = await queue.enqueueCueJob({
      jobId: "job_001",
      conversationId: "conv_001",
      triggerWindowId: "conv_001:000001:000001:8",
      sourceChunkStart: "000001",
      sourceChunkEnd: "000001",
      reasons: ["QUESTION"],
      wordCount: 8,
      enqueuedAt: "2026-06-16T10:00:00.000Z",
    });
    const duplicate = await queue.enqueueCueJob({
      jobId: "job_002",
      conversationId: "conv_001",
      triggerWindowId: "conv_001:000001:000001:8",
      sourceChunkStart: "000001",
      sourceChunkEnd: "000001",
      reasons: ["QUESTION"],
      wordCount: 8,
      enqueuedAt: "2026-06-16T10:00:01.000Z",
    });

    expect(first.jobId).toBe("job_001");
    expect(duplicate.jobId).toBe("job_001");
    expect(queue.listJobsForTest()).toHaveLength(1);
    await expect(queue.hasPendingCueJob("conv_001")).resolves.toBe(true);
  });

  test("moves jobs through receive, complete, and failure states", async () => {
    const queue = new InMemoryCueJobQueue();
    await queue.enqueueCueJob({
      jobId: "job_001",
      conversationId: "conv_001",
      triggerWindowId: "conv_001:000001:000001:8",
      sourceChunkStart: "000001",
      sourceChunkEnd: "000001",
      reasons: ["QUESTION"],
      wordCount: 8,
      enqueuedAt: "2026-06-16T10:00:00.000Z",
    });

    const received = await queue.receiveNextCueJob();
    expect(received).toMatchObject({ status: "IN_PROGRESS", attempts: 1 });
    await expect(queue.hasPendingCueJob("conv_001")).resolves.toBe(true);

    const completed = await queue.completeCueJob("job_001");
    expect(completed).toMatchObject({ status: "COMPLETED" });
    await expect(queue.hasPendingCueJob("conv_001")).resolves.toBe(false);

    const failed = await queue.failCueJob("job_001", "worker timeout");
    expect(failed).toMatchObject({ status: "FAILED", lastError: "worker timeout" });
  });
});
