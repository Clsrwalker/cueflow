import { CUE_TYPES, type Cue, type ConversationSummary, type ValidationResult, type WebSocketSendTranscriptMessage } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredString(input: Record<string, unknown>, field: string, errors: string[]): string {
  const value = input[field];
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${field} must be a non-empty string`);
    return "";
  }
  return value.trim();
}

function readOptionalString(input: Record<string, unknown>, field: string, errors: string[]): string | undefined {
  const value = input[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    errors.push(`${field} must be a string`);
    return undefined;
  }
  return value.trim() || undefined;
}

function readOptionalBoolean(input: Record<string, unknown>, field: string, errors: string[]): boolean | undefined {
  const value = input[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    errors.push(`${field} must be a boolean`);
    return undefined;
  }
  return value;
}

function isIsoLike(value: string): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time);
}

export function validateSendTranscriptMessage(input: unknown): ValidationResult<WebSocketSendTranscriptMessage> {
  if (!isRecord(input)) {
    return { ok: false, errors: ["message must be an object"] };
  }

  const errors: string[] = [];
  const action = readRequiredString(input, "action", errors);
  const conversationId = readRequiredString(input, "conversationId", errors);
  const chunkId = readRequiredString(input, "chunkId", errors);
  const speaker = readRequiredString(input, "speaker", errors);
  const text = readRequiredString(input, "text", errors);
  const clientTimestamp = readRequiredString(input, "clientTimestamp", errors);
  const autoCue = readOptionalBoolean(input, "autoCue", errors);
  const promptContext = readOptionalString(input, "promptContext", errors);

  if (action && action !== "sendTranscript") {
    errors.push("action must be sendTranscript");
  }
  if (clientTimestamp && !isIsoLike(clientTimestamp)) {
    errors.push("clientTimestamp must be an ISO timestamp");
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      action: "sendTranscript",
      conversationId,
      chunkId,
      speaker,
      text,
      clientTimestamp,
      ...(typeof autoCue === "boolean" ? { autoCue } : {}),
      ...(promptContext ? { promptContext } : {}),
    },
  };
}

export function validateCueResult(input: Cue): ValidationResult<Cue> {
  const errors: string[] = [];
  if (!CUE_TYPES.includes(input.type)) errors.push("cue type is unsupported");
  if (!input.title.trim()) errors.push("cue title is required");
  if (!input.shortText.trim()) errors.push("cue shortText is required");
  if (!input.detailText.trim()) errors.push("cue detailText is required");
  if (input.confidence < 0 || input.confidence > 1) errors.push("cue confidence must be between 0 and 1");
  return errors.length ? { ok: false, errors } : { ok: true, value: input };
}

export function validateSummaryResult(input: ConversationSummary): ValidationResult<ConversationSummary> {
  const errors: string[] = [];
  if (!input.conversationId.trim()) errors.push("summary conversationId is required");
  if (!input.summary.trim()) errors.push("summary text is required");
  if (!Array.isArray(input.keyTopics)) errors.push("summary keyTopics must be an array");
  if (!Array.isArray(input.actionItems)) errors.push("summary actionItems must be an array");
  if (!Array.isArray(input.risks)) errors.push("summary risks must be an array");
  return errors.length ? { ok: false, errors } : { ok: true, value: input };
}
