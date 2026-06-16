import { describe, expect, test } from "vitest";
import { InMemorySummaryJobQueue } from "./in-memory-summary-job-queue.js";

describe("InMemorySummaryJobQueue", () => {
  test("keeps one pending summary job per conversation", async () => {
    const queue = new InMemorySummaryJobQueue();

    const first = await queue.enqueueSummaryJob({
      jobId: "summary_001",
      conversationId: "conv_001",
      enqueuedAt: "2026-06-16T10:00:00.000Z",
    });
    const duplicate = await queue.enqueueSummaryJob({
      jobId: "summary_002",
      conversationId: "conv_001",
      enqueuedAt: "2026-06-16T10:00:01.000Z",
    });

    expect(first.jobId).toBe("summary_001");
    expect(duplicate.jobId).toBe("summary_001");
    expect(queue.listJobsForTest()).toHaveLength(1);
    await expect(queue.hasPendingSummaryJob("conv_001")).resolves.toBe(true);
  });

  test("moves summary jobs through worker states", async () => {
    const queue = new InMemorySummaryJobQueue();
    await queue.enqueueSummaryJob({
      jobId: "summary_001",
      conversationId: "conv_001",
      enqueuedAt: "2026-06-16T10:00:00.000Z",
    });

    const received = await queue.receiveNextSummaryJob();
    expect(received).toMatchObject({ status: "IN_PROGRESS", attempts: 1 });

    const completed = await queue.completeSummaryJob("summary_001");
    expect(completed).toMatchObject({ status: "COMPLETED" });
    await expect(queue.hasPendingSummaryJob("conv_001")).resolves.toBe(false);
  });
});
