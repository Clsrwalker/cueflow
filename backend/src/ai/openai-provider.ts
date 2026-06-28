import OpenAI from "openai";
import { CUE_TYPES, type CueType, type TranscriptChunk } from "@cueflow/shared";
import type { AiProvider, CueContextWindow, CueProviderResult, SummaryProviderResult } from "./types.js";

export const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";

export type OpenAiProviderOptions = {
  apiKey?: string;
  model?: string;
  client?: OpenAI;
};

type CueJson = {
  type: CueType;
  title: string;
  shortText: string;
  detailText: string;
  confidence: number;
};

type SummaryJson = SummaryProviderResult;

const cueSchema = {
  type: "object",
  additionalProperties: false,
  required: ["type", "title", "shortText", "detailText", "confidence"],
  properties: {
    type: { type: "string", enum: CUE_TYPES },
    title: { type: "string" },
    shortText: { type: "string" },
    detailText: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

const summarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "keyTopics", "actionItems", "risks"],
  properties: {
    summary: { type: "string" },
    keyTopics: { type: "array", items: { type: "string" } },
    actionItems: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
  },
} as const;

function combinedTranscript(chunks: TranscriptChunk[]): string {
  return chunks
    .map((chunk) => `${chunk.speaker}: ${chunk.text}`)
    .join("\n")
    .trim();
}

function sourceStart(chunks: TranscriptChunk[]): string {
  return chunks[0]?.chunkId ?? "unknown";
}

function sourceEnd(chunks: TranscriptChunk[]): string {
  return chunks[chunks.length - 1]?.chunkId ?? sourceStart(chunks);
}

function parseJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label} response was not valid JSON.`);
  }
}

function cleanString(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} is required in OpenAI response.`);
  }
  return trimmed;
}

function cleanStringList(values: string[], field: string): string[] {
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  if (!cleaned.length) {
    throw new Error(`${field} must contain at least one item in OpenAI response.`);
  }
  return cleaned;
}

function normalizeCue(input: CueJson, chunks: TranscriptChunk[]): CueProviderResult {
  if (!CUE_TYPES.includes(input.type)) {
    throw new Error("OpenAI response returned an unsupported cue type.");
  }

  return {
    type: input.type,
    title: cleanString(input.title, "title").slice(0, 80),
    shortText: cleanString(input.shortText, "shortText").slice(0, 220),
    detailText: cleanString(input.detailText, "detailText").slice(0, 900),
    sourceChunkStart: sourceStart(chunks),
    sourceChunkEnd: sourceEnd(chunks),
    confidence: Math.min(1, Math.max(0, input.confidence)),
  };
}

function normalizeSummary(input: SummaryJson): SummaryProviderResult {
  return {
    summary: cleanString(input.summary, "summary"),
    keyTopics: cleanStringList(input.keyTopics, "keyTopics"),
    actionItems: cleanStringList(input.actionItems, "actionItems"),
    risks: cleanStringList(input.risks, "risks"),
  };
}

function makeClient(options: OpenAiProviderOptions): OpenAI {
  if (options.client) return options.client;
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required when CUEFLOW_AI_PROVIDER=openai.");
  }
  return new OpenAI({ apiKey });
}

export class OpenAiProvider implements AiProvider {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAiProviderOptions = {}) {
    this.client = makeClient(options);
    this.model = options.model ?? process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
  }

  async generateCue(contextWindow: CueContextWindow): Promise<CueProviderResult> {
    const transcript = combinedTranscript(contextWindow.chunks);
    const response = await this.client.responses.create({
      model: this.model,
      input: [
        {
          role: "system",
          content: [
            "You generate concise CueFlow conversation intelligence cards.",
            "Return exactly one cue for the transcript window.",
            "Use CONCEPT, DECISION, RISK, ACTION, or SUMMARY.",
            "Prefer practical cloud architecture insight over generic advice.",
          ].join(" "),
        },
        {
          role: "user",
          content: transcript || "No transcript content.",
        },
      ],
      max_output_tokens: 450,
      reasoning: { effort: "low" },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "cueflow_cue",
          strict: true,
          schema: cueSchema,
        },
      },
    });

    return normalizeCue(parseJson<CueJson>(response.output_text, "Cue"), contextWindow.chunks);
  }

  async generateSummary(fullTranscript: TranscriptChunk[]): Promise<SummaryProviderResult> {
    const transcript = combinedTranscript(fullTranscript);
    const response = await this.client.responses.create({
      model: this.model,
      input: [
        {
          role: "system",
          content: [
            "You create CueFlow conversation summaries.",
            "Summarize the transcript into summary, keyTopics, actionItems, and risks.",
            "Keep items concrete and useful for a cloud architecture course demo.",
          ].join(" "),
        },
        {
          role: "user",
          content: transcript || "No transcript content.",
        },
      ],
      max_output_tokens: 900,
      reasoning: { effort: "low" },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "cueflow_summary",
          strict: true,
          schema: summarySchema,
        },
      },
    });

    return normalizeSummary(parseJson<SummaryJson>(response.output_text, "Summary"));
  }
}
