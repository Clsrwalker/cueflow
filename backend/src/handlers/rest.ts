import { createHash } from "node:crypto";
import type { Conversation, UsedPrenote } from "@cueflow/shared";
import type { ConversationService } from "../services/conversation-service.js";
import {
  ConversationNotFoundError,
  ConversationServiceError,
  DEFAULT_USER_ID,
  InvalidConversationInputError,
} from "../services/conversation-service.js";
import type { SummaryJobQueue } from "../queues/types.js";
import type { AudioTranscriber, TranscriptionLanguage } from "../ai/transcription-provider.js";

type Clock = () => Date;
type IdFactory = () => string;

export type RestHandlerOptions = {
  summaryQueue?: SummaryJobQueue;
  transcriber?: AudioTranscriber;
  clock?: Clock;
  idFactory?: IdFactory;
};

export type RestRequest = {
  body?: string | null;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
  isBase64Encoded?: boolean;
  method?: string;
  path?: string;
  queryStringParameters?: Record<string, string | undefined> | null;
  rawPath?: string;
  requestContext?: {
    http?: {
      method?: string;
      path?: string;
    };
  };
};

export type RestResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

type RouteParts = {
  method: string;
  path: string;
  segments: string[];
};

const JSON_HEADERS = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,authorization,x-cueflow-user-id",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

function json(statusCode: number, payload: unknown): RestResponse {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  };
}

function noContent(): RestResponse {
  return {
    statusCode: 204,
    headers: JSON_HEADERS,
    body: "",
  };
}

function routeParts(event: RestRequest): RouteParts {
  const method = (event.httpMethod ?? event.requestContext?.http?.method ?? event.method ?? "GET").toUpperCase();
  const path = event.rawPath ?? event.path ?? event.requestContext?.http?.path ?? "/";
  const segments = path
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);

  return {
    method,
    path,
    segments,
  };
}

function parseJsonBody(event: RestRequest): Record<string, unknown> {
  if (!event.body) return {};
  const body = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;

  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new InvalidConversationInputError("JSON body must be an object.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ConversationServiceError) throw error;
    throw new InvalidConversationInputError("Request body must contain valid JSON.");
  }
}

function optionalString(input: Record<string, unknown>, field: string): string | undefined {
  const value = input[field];
  return typeof value === "string" ? value : undefined;
}

function requireString(input: Record<string, unknown>, field: string, max: number): string {
  const value = optionalString(input, field)?.trim() ?? "";
  if (!value) throw new InvalidConversationInputError(`${field} is required.`);
  return value.slice(0, max);
}

function cleanString(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function optionalUsedPrenote(input: Record<string, unknown>): UsedPrenote | undefined {
  const value = input.usedPrenote;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidConversationInputError("usedPrenote must be an object.");
  }
  const raw = value as Record<string, unknown>;
  const title = cleanString(raw.title, 160);
  const text = cleanText(raw.text, 12000);
  if (!title && !text) {
    throw new InvalidConversationInputError("usedPrenote title or text is required.");
  }
  return {
    id: cleanString(raw.id, 140) || "used-prenote",
    title: title || text.slice(0, 80) || "Prepared Note",
    text: text || title,
  };
}

function optionalTranscriptionLanguage(input: Record<string, unknown>): TranscriptionLanguage | undefined {
  const value = optionalString(input, "language")?.trim().toLowerCase();
  if (!value) return undefined;
  if (value === "english" || value === "chinese" || value === "auto") return value;
  throw new InvalidConversationInputError("language must be english, chinese, or auto.");
}

function realtimeLanguageCode(language: TranscriptionLanguage | undefined): string | undefined {
  if (language === "english") return "en";
  if (language === "chinese") return "zh";
  return undefined;
}

function safetyIdentifier(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 40);
}

function extractRealtimeClientSecret(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  if (typeof record.value === "string") return record.value;
  const clientSecret = record.client_secret ?? record.clientSecret;
  if (clientSecret && typeof clientSecret === "object") {
    const value = (clientSecret as Record<string, unknown>).value;
    if (typeof value === "string") return value;
  }
  return "";
}

async function createRealtimeClientSecret(event: RestRequest, body: Record<string, unknown>) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new ConversationServiceError("OPENAI_NOT_CONFIGURED", "OpenAI realtime transcription is not configured.", 503);
  }

  const language = optionalTranscriptionLanguage(body);
  const model = process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL?.trim() || "gpt-realtime-whisper";
  const delay = process.env.OPENAI_REALTIME_TRANSCRIPTION_DELAY?.trim() || "low";
  const transcription: Record<string, string> = { model, delay };
  const code = realtimeLanguageCode(language);
  if (code) transcription.language = code;

  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "OpenAI-Safety-Identifier": safetyIdentifier(requestUserIdOrDefault(event, body)),
    },
    body: JSON.stringify({
      session: {
        type: "transcription",
        audio: {
          input: {
            transcription,
          },
        },
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(JSON.stringify({
      eventName: "cueflow.realtime_secret_failed",
      status: response.status,
      payload,
    }));
    throw new ConversationServiceError("REALTIME_SESSION_FAILED", "OpenAI realtime transcription session failed.", 502);
  }

  const clientSecret = extractRealtimeClientSecret(payload);
  if (!clientSecret) {
    throw new ConversationServiceError("REALTIME_SESSION_INVALID", "OpenAI realtime transcription returned an invalid session.", 502);
  }

  return {
    clientSecret,
    model,
    delay,
    language: language ?? "auto",
  };
}

function headerValue(event: RestRequest, name: string): string | undefined {
  const headers = event.headers ?? {};
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return headers[key];
  }
  return undefined;
}

function requestUserId(event: RestRequest, body?: Record<string, unknown>): string | undefined {
  return event.queryStringParameters?.userId
    ?? headerValue(event, "x-cueflow-user-id")
    ?? (body ? optionalString(body, "userId") : undefined);
}

function requestUserIdOrDefault(event: RestRequest, body?: Record<string, unknown>): string {
  return requestUserId(event, body)?.trim() || DEFAULT_USER_ID;
}

async function requireOwnedConversation(
  service: ConversationService,
  event: RestRequest,
  conversationId: string,
  body?: Record<string, unknown>,
): Promise<Conversation> {
  const conversation = await service.getConversation(conversationId);
  if (conversation.userId !== requestUserIdOrDefault(event, body)) {
    throw new ConversationNotFoundError(conversationId);
  }
  return conversation;
}

function defaultIdFactory(): string {
  return Math.random().toString(36).slice(2, 12);
}

function errorResponse(error: unknown): RestResponse {
  if (error instanceof ConversationServiceError) {
    return json(error.statusCode, {
      error: {
        code: error.code,
        message: error.message,
      },
    });
  }

  return json(500, {
    error: {
      code: "INTERNAL_ERROR",
      message: "Unexpected server error.",
    },
  });
}

export function createRestHandler(
  service: ConversationService,
  options: RestHandlerOptions = {},
): (event: RestRequest) => Promise<RestResponse> {
  const clock = options.clock ?? (() => new Date());
  const idFactory = options.idFactory ?? defaultIdFactory;

  return async (event: RestRequest): Promise<RestResponse> => {
    try {
      const route = routeParts(event);

      if (route.method === "OPTIONS") {
        return noContent();
      }

      if (route.method === "POST" && route.segments.length === 2 && route.segments[0] === "realtime" && route.segments[1] === "client-secret") {
        const body = parseJsonBody(event);
        const session = await createRealtimeClientSecret(event, body);
        return json(200, session);
      }

      if (route.method === "POST" && route.segments.length === 1 && route.segments[0] === "transcribe") {
        if (!options.transcriber) {
          return json(501, {
            error: {
              code: "TRANSCRIPTION_NOT_CONFIGURED",
              message: "Audio transcription is not configured.",
            },
          });
        }
        const body = parseJsonBody(event);
        const audioBase64 = requireString(body, "audioBase64", 7_500_000);
        const mimeType = cleanString(body.mimeType, 120) || "audio/webm";
        const language = optionalTranscriptionLanguage(body);
        const promptContext = cleanText(body.promptContext, 2000) || undefined;
        const result = await options.transcriber.transcribe({
            audioBase64,
            mimeType,
            language,
            promptContext,
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            console.error(JSON.stringify({
              eventName: "cueflow.transcription_failed",
              mimeType,
              audioBytes: Math.floor(audioBase64.length * 0.75),
              message,
            }));
            throw new ConversationServiceError("TRANSCRIPTION_FAILED", "Audio transcription failed.", 502);
          });
        return json(200, {
          transcript: result.text,
          text: result.text,
          model: result.model,
          language: result.language,
        });
      }

      if (route.method === "POST" && route.segments.length === 1 && route.segments[0] === "conversations") {
        const body = parseJsonBody(event);
        const conversation = await service.createConversation({
          userId: requestUserId(event, body),
        });
        return json(201, { conversation });
      }

      if (route.method === "GET" && route.segments.length === 1 && route.segments[0] === "conversations") {
        const conversations = await service.listConversations({
          userId: requestUserId(event),
        });
        return json(200, { conversations });
      }

      if (route.segments.length === 2 && route.segments[0] === "conversations") {
        const conversationId = route.segments[1];
        if (route.method === "GET") {
          const conversation = await requireOwnedConversation(service, event, conversationId);
          return json(200, { conversation });
        }
      }

      if (route.segments.length === 3 && route.segments[0] === "conversations") {
        const conversationId = route.segments[1];
        const child = route.segments[2];

        if (route.method === "GET" && child === "cues") {
          await requireOwnedConversation(service, event, conversationId);
          const cues = await service.listCues(conversationId);
          return json(200, { cues });
        }

        if (route.method === "GET" && child === "transcript") {
          await requireOwnedConversation(service, event, conversationId);
          const transcript = await service.listTranscriptChunks(conversationId);
          return json(200, { transcript });
        }

        if (route.method === "POST" && child === "end") {
          const body = parseJsonBody(event);
          await requireOwnedConversation(service, event, conversationId, body);
          const promptContext = optionalString(body, "promptContext")?.trim() || undefined;
          const result = await service.endConversation(conversationId, {
            promptContext,
            usedPrenote: optionalUsedPrenote(body),
          });
          const shouldEnqueueSummary = result.conversation.summaryStatus !== "READY"
            && options.summaryQueue
            && !(await options.summaryQueue.hasPendingSummaryJob(conversationId));
          const summaryJob = shouldEnqueueSummary
            ? await options.summaryQueue!.enqueueSummaryJob({
                jobId: `summaryjob_${idFactory()}`,
                conversationId,
                enqueuedAt: clock().toISOString(),
                ...(result.promptContext ? { promptContext: result.promptContext } : {}),
              })
            : null;
          return json(200, {
            conversation: result.conversation,
            transcriptObjectKey: result.transcriptObjectKey,
            summaryJobEnqueued: Boolean(summaryJob),
            summaryJob,
          });
        }

        if (route.method === "GET" && child === "summary") {
          await requireOwnedConversation(service, event, conversationId);
          const summary = await service.getSummary(conversationId);
          return json(200, { summary });
        }
      }

      if (route.method === "POST" && route.segments.length === 2 && route.segments[0] === "demo" && route.segments[1] === "replay") {
        return json(501, {
          error: {
            code: "DEMO_REPLAY_NOT_IMPLEMENTED",
            message: "Demo replay will be implemented in Phase 6.",
          },
        });
      }

      return json(404, {
        error: {
          code: "ROUTE_NOT_FOUND",
          message: `No route matches ${route.method} ${route.path}.`,
        },
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}
