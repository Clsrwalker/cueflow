import { describe, expect, test } from "vitest";
import { buildSummaryFromTranscript } from "./summary-builder.js";
import { chunk } from "../test-helpers.js";

describe("summary builder", () => {
  test("creates structured summary content from architecture transcript chunks", () => {
    const summary = buildSummaryFromTranscript([
      chunk({ chunkId: "000001", text: "We need to design the cloud architecture for CueFlow." }),
      chunk({ chunkId: "000002", text: "Should we use WebSocket or REST polling for real-time AI cues?" }),
      chunk({ chunkId: "000003", text: "We should use SQS so transcript ingestion does not wait for the AI worker." }),
      chunk({ chunkId: "000004", text: "The main risk is AI latency, especially if every chunk calls the model." }),
      chunk({ chunkId: "000005", text: "DynamoDB can store metadata and S3 can store raw transcript objects." }),
    ]);

    expect(summary.summary).toContain("WebSocket real-time delivery");
    expect(summary.keyTopics).toEqual(expect.arrayContaining([
      "WebSocket real-time delivery",
      "REST API lifecycle",
      "SQS async processing",
      "DynamoDB metadata storage",
      "S3 transcript and summary storage",
      "AI cue generation",
    ]));
    expect(summary.actionItems).toEqual(expect.arrayContaining([
      "We need to design the cloud architecture for CueFlow.",
      "We should use SQS so transcript ingestion does not wait for the AI worker.",
    ]));
    expect(summary.risks).toEqual(expect.arrayContaining([
      "The main risk is AI latency, especially if every chunk calls the model.",
    ]));
  });

  test("returns fallbacks for empty transcript input", () => {
    const summary = buildSummaryFromTranscript([]);

    expect(summary.summary).toContain("did not contain enough transcript");
    expect(summary.keyTopics).toEqual(["Conversation architecture"]);
    expect(summary.actionItems).toEqual(["Review generated cues and finalize the next implementation step."]);
    expect(summary.risks).toEqual(["No major risks were explicitly identified in the transcript."]);
  });
});
