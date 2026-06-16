import { describe, expect, test } from "vitest";
import {
  chunkItemKeys,
  connectionItemKeys,
  conversationItemKeys,
  cueItemKeys,
  fullTranscriptS3Key,
  rawChunkS3Key,
  summaryS3Key,
} from "./keys.js";

describe("CueFlow key builders", () => {
  test("builds conversation metadata keys with user access index", () => {
    expect(conversationItemKeys({
      userId: "demo-user",
      conversationId: "c_001",
      startedAt: "2026-06-16T10:00:00.000Z",
    })).toEqual({
      PK: "USER#demo-user",
      SK: "CONV#c_001",
      GSI1PK: "USER#demo-user",
      GSI1SK: "2026-06-16T10:00:00.000Z",
    });
  });

  test("builds conversation-scoped item keys", () => {
    expect(chunkItemKeys("c_001", "000001")).toEqual({
      PK: "CONV#c_001",
      SK: "CHUNK#000001",
    });
    expect(cueItemKeys("c_001", "20260616T100008Z", "cue_001")).toEqual({
      PK: "CONV#c_001",
      SK: "CUE#20260616T100008Z#cue_001",
    });
    expect(connectionItemKeys("c_001", "abc123")).toEqual({
      PK: "CONV#c_001",
      SK: "CONNECTION#abc123",
    });
  });

  test("builds S3 object keys for transcript and summary objects", () => {
    expect(rawChunkS3Key("c_001", "000001")).toBe("raw/c_001/chunks/000001.json");
    expect(fullTranscriptS3Key("c_001")).toBe("raw/c_001/full-transcript.json");
    expect(summaryS3Key("c_001")).toBe("summaries/c_001/summary.json");
  });

  test("rejects empty or delimiter-containing key parts", () => {
    expect(() => chunkItemKeys(" ", "000001")).toThrow("conversationId is required");
    expect(() => chunkItemKeys("c#001", "000001")).toThrow("conversationId must not contain #");
  });
});

