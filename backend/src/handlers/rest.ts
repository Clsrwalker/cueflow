import type { ConversationService } from "../services/conversation-service.js";
import {
  ConversationServiceError,
  InvalidConversationInputError,
} from "../services/conversation-service.js";
import type { SummaryJobQueue } from "../queues/types.js";

type Clock = () => Date;
type IdFactory = () => string;

export type RestHandlerOptions = {
  summaryQueue?: SummaryJobQueue;
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
  "access-control-allow-headers": "content-type",
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

      if (route.method === "POST" && route.segments.length === 1 && route.segments[0] === "conversations") {
        const body = parseJsonBody(event);
        const conversation = await service.createConversation({
          userId: optionalString(body, "userId"),
        });
        return json(201, { conversation });
      }

      if (route.method === "GET" && route.segments.length === 1 && route.segments[0] === "conversations") {
        const conversations = await service.listConversations({
          userId: event.queryStringParameters?.userId,
        });
        return json(200, { conversations });
      }

      if (route.segments.length === 2 && route.segments[0] === "conversations") {
        const conversationId = route.segments[1];
        if (route.method === "GET") {
          const conversation = await service.getConversation(conversationId);
          return json(200, { conversation });
        }
      }

      if (route.segments.length === 3 && route.segments[0] === "conversations") {
        const conversationId = route.segments[1];
        const child = route.segments[2];

        if (route.method === "GET" && child === "cues") {
          const cues = await service.listCues(conversationId);
          return json(200, { cues });
        }

        if (route.method === "POST" && child === "end") {
          const result = await service.endConversation(conversationId);
          const shouldEnqueueSummary = result.conversation.summaryStatus !== "READY"
            && options.summaryQueue
            && !(await options.summaryQueue.hasPendingSummaryJob(conversationId));
          const summaryJob = shouldEnqueueSummary
            ? await options.summaryQueue!.enqueueSummaryJob({
                jobId: `summaryjob_${idFactory()}`,
                conversationId,
                enqueuedAt: clock().toISOString(),
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
