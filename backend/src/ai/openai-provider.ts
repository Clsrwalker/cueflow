import OpenAI from "openai";
import { CUE_TYPES, type CueType, type TranscriptChunk } from "@cueflow/shared";
import type { AiProvider, CueContextWindow, CueProviderResult, SummaryProviderOptions, SummaryProviderResult } from "./types.js";

export const DEFAULT_OPENAI_MODEL = "gpt-5.4-nano";
export const DEFAULT_OPENAI_SUMMARY_MODEL = "gpt-5.4-mini";

export type OpenAiProviderOptions = {
  apiKey?: string;
  model?: string;
  summaryModel?: string;
  client?: OpenAI;
};

type CueJson = {
  type: CueType | "NONE";
  title: string;
  shortText: string;
  detailText: string;
  confidence: number;
  reason: string;
};

type SummaryJson = SummaryProviderResult;

const CUE_TITLE_MAX_CHARS = 34;
const CUE_TITLE_MAX_WORDS = 5;
const CUE_SHORT_MAX_CHARS = 190;
const CUE_DETAIL_MAX_CHARS = 700;

const cueSchema = {
  type: "object",
  additionalProperties: false,
  required: ["type", "title", "shortText", "detailText", "confidence", "reason"],
  properties: {
    type: { type: "string", enum: [...CUE_TYPES, "NONE"] },
    title: { type: "string" },
    shortText: { type: "string" },
    detailText: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string" },
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

function promptWithContext(transcript: string, promptContext?: string): string {
  const context = promptContext?.trim();
  if (!context) return transcript || "No transcript content.";
  const contextBlock = /^prepared context:/i.test(context)
    ? context
    : `Prepared context:\n${context}`;
  return [
    contextBlock,
    "",
    "Transcript:",
    transcript || "No transcript content.",
  ].join("\n");
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

function cleanOneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function canonicalCueText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fallbackTitleForCueType(type: CueType): string {
  if (type === "DECISION") return "Decision point";
  if (type === "RISK") return "Risk";
  if (type === "ACTION") return "Next step";
  if (type === "SUMMARY") return "Quick recap";
  return "Key concept";
}

function isTitleTooCloseToText(title: string, text: string): boolean {
  const titleKey = canonicalCueText(title);
  const textKey = canonicalCueText(text);
  if (!titleKey || !textKey) return false;
  if (titleKey === textKey) return true;
  if (textKey.startsWith(`${titleKey} `) && titleKey.length >= 18) return true;
  const shorter = titleKey.length < textKey.length ? titleKey : textKey;
  const longer = titleKey.length < textKey.length ? textKey : titleKey;
  return longer.startsWith(shorter) && shorter.length / Math.max(longer.length, 1) >= 0.82;
}

function compactCueTitle(rawTitle: string, type: CueType, shortText: string): string {
  const cleaned = cleanOneLine(rawTitle).replace(/[.!?:;,]+$/g, "");
  if (!cleaned || isTitleTooCloseToText(cleaned, shortText)) {
    return fallbackTitleForCueType(type);
  }

  const words = cleaned.split(/\s+/).slice(0, CUE_TITLE_MAX_WORDS).join(" ");
  const clipped = words
    .slice(0, CUE_TITLE_MAX_CHARS)
    .replace(/[^\p{Letter}\p{Number}]+$/gu, "")
    .trim();
  return clipped || fallbackTitleForCueType(type);
}

function removeDuplicatedTitleLead(text: string, rawTitle: string): string {
  const cleanedText = text.trim();
  const cleanedTitle = cleanOneLine(rawTitle).replace(/[.!?:;,]+$/g, "");
  if (!cleanedText || !cleanedTitle) return cleanedText;

  const lowerText = cleanedText.toLowerCase();
  const lowerTitle = cleanedTitle.toLowerCase();
  if (!lowerText.startsWith(lowerTitle)) return cleanedText;

  const rest = cleanedText.slice(cleanedTitle.length).replace(/^[\s:;,.!?-]+/, "").trim();
  return rest.length >= 18 ? rest : cleanedText;
}

function cleanOptionalString(value: string | undefined, fallback: string, max: number): string {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  return (cleaned || fallback).slice(0, max);
}

function cleanStringList(values: string[], field: string, requireAny = false): string[] {
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  if (requireAny && !cleaned.length) {
    throw new Error(`${field} must contain at least one item in OpenAI response.`);
  }
  return cleaned;
}

function normalizeCue(input: CueJson, chunks: TranscriptChunk[]): CueProviderResult {
  const confidence = Math.min(1, Math.max(0, input.confidence));

  if (input.type === "NONE") {
    return {
      display: false,
      skipReason: cleanOptionalString(input.reason, "model chose no cue", 240),
      sourceChunkStart: sourceStart(chunks),
      sourceChunkEnd: sourceEnd(chunks),
      confidence,
    };
  }

  if (!CUE_TYPES.includes(input.type)) {
    throw new Error("OpenAI response returned an unsupported cue type.");
  }

  const rawTitle = cleanString(input.title, "title");
  const rawShortText = cleanOneLine(cleanString(input.shortText, "shortText"));
  const rawDetailText = cleanString(input.detailText, "detailText");
  const title = compactCueTitle(rawTitle, input.type, rawShortText);
  const shortText = removeDuplicatedTitleLead(rawShortText, rawTitle).slice(0, CUE_SHORT_MAX_CHARS);
  const detailText = removeDuplicatedTitleLead(rawDetailText, rawTitle).slice(0, CUE_DETAIL_MAX_CHARS);

  return {
    type: input.type,
    title,
    shortText,
    detailText,
    sourceChunkStart: sourceStart(chunks),
    sourceChunkEnd: sourceEnd(chunks),
    confidence,
  };
}

function normalizeSummary(input: SummaryJson): SummaryProviderResult {
  return {
    summary: cleanString(input.summary, "summary"),
    keyTopics: cleanStringList(input.keyTopics, "keyTopics", true),
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
  private readonly summaryModel: string;

  constructor(options: OpenAiProviderOptions = {}) {
    this.client = makeClient(options);
    this.model = options.model ?? process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
    this.summaryModel = options.summaryModel ?? process.env.OPENAI_SUMMARY_MODEL ?? DEFAULT_OPENAI_SUMMARY_MODEL;
  }

  async generateCue(contextWindow: CueContextWindow): Promise<CueProviderResult> {
    const transcript = combinedTranscript(contextWindow.chunks);
    const response = await this.client.responses.create({
      model: this.model,
      input: [
        {
          role: "system",
          content: [
            "You generate high-signal CueFlow conversation intelligence cards.",
            "Return exactly one JSON object for the transcript window.",
            "Use CONCEPT, DECISION, RISK, ACTION, SUMMARY, or NONE.",
            "Use NONE when the transcript is a greeting, filler, incomplete fragment, duplicate of a recent idea, or not clearly useful.",
            "This is a live Mentra/SayNext-style assistant: produce a concise cue quickly when the speaker asks a question, gets stuck, asks what to say next, needs an explanation, or raises a risk/decision.",
            "The backend may send broad real-time transcript windows for AI review; decide whether a user-visible cue is warranted now.",
            "For direct questions, requests for help, or spoken STT questions without punctuation, return a cue unless the transcript is purely an audio check.",
            "Keep live cues short enough to read during the conversation.",
            "title must be a compact label, 2-5 words and at most 34 characters. It must not be a sentence and must not repeat shortText.",
            "shortText carries the answer or action in one concise sentence. detailText may add one supporting sentence and must not begin by repeating the title.",
            "Use prepared context when it is supplied, but do not invent facts outside the transcript.",
            "Prefer specific, practical insight over generic advice.",
            "A skipped cue is better than a noisy cue.",
          ].join(" "),
        },
        {
          role: "user",
          content: promptWithContext(transcript, contextWindow.promptContext),
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

  async generateSummary(fullTranscript: TranscriptChunk[], options: SummaryProviderOptions = {}): Promise<SummaryProviderResult> {
    const transcript = combinedTranscript(fullTranscript);
    const response = await this.client.responses.create({
      model: this.summaryModel,
      input: [
        {
          role: "system",
          content: [
            "You create CueFlow conversation summaries.",
            "Summarize the transcript into summary, keyTopics, actionItems, and risks.",
            "Use prepared context when it is supplied to interpret domain terms and expected topics.",
            "Keep items concrete and useful for a cloud architecture course demo.",
          ].join(" "),
        },
        {
          role: "user",
          content: promptWithContext(transcript, options.promptContext),
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
