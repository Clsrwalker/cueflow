import type { ConversationServiceError } from "../services/conversation-service.js";
import {
  toWebSocketServiceError,
  type WebSocketService,
  type WebSocketServiceError,
} from "../websocket/websocket-service.js";

export type WebSocketRequest = {
  body?: string | null;
  isBase64Encoded?: boolean;
  queryStringParameters?: Record<string, string | undefined> | null;
  requestContext?: {
    connectionId?: string;
    routeKey?: string;
  };
};

export type WebSocketResponse = {
  statusCode: number;
  body: string;
};

function json(statusCode: number, payload: unknown): WebSocketResponse {
  return {
    statusCode,
    body: JSON.stringify(payload),
  };
}

function parseJsonBody(event: WebSocketRequest): unknown {
  if (!event.body) return {};
  const body = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error("INVALID_JSON");
  }
}

function routeKey(event: WebSocketRequest, payload: unknown): string {
  const current = event.requestContext?.routeKey;
  if (current && current !== "$default") return current;
  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    const action = (payload as { action?: unknown }).action;
    if (typeof action === "string") return action;
  }
  return current ?? "$default";
}

function connectionId(event: WebSocketRequest): string {
  return event.requestContext?.connectionId ?? "";
}

function errorResponse(error: unknown): WebSocketResponse {
  if (error instanceof Error && error.message === "INVALID_JSON") {
    return json(400, {
      error: {
        code: "INVALID_JSON",
        message: "Request body must contain valid JSON.",
      },
    });
  }

  const mapped: WebSocketServiceError | ConversationServiceError = toWebSocketServiceError(error);
  return json(mapped.statusCode, {
    error: {
      code: mapped.code,
      message: mapped.message,
    },
  });
}

export function createWebSocketHandler(service: WebSocketService): (event: WebSocketRequest) => Promise<WebSocketResponse> {
  return async (event: WebSocketRequest): Promise<WebSocketResponse> => {
    try {
      if (event.requestContext?.routeKey === "$connect") {
        const connection = await service.connect({
          connectionId: connectionId(event),
          conversationId: event.queryStringParameters?.conversationId ?? "",
          userId: event.queryStringParameters?.userId,
        });
        return json(200, { connection });
      }

      if (event.requestContext?.routeKey === "$disconnect") {
        const connection = await service.disconnect(connectionId(event));
        return json(200, { disconnected: Boolean(connection) });
      }

      const payload = parseJsonBody(event);
      const route = routeKey(event, payload);

      if (route === "sendTranscript") {
        const result = await service.sendTranscript(connectionId(event), payload);
        return json(200, {
          ack: result.ack,
          cueJobEnqueued: Boolean(result.cueJob),
          triggerReasons: result.evaluation.reasons,
        });
      }

      if (route === "ping") {
        const eventPayload = await service.ping(connectionId(event));
        return json(200, { event: eventPayload });
      }

      if (route === "clientAckCue") {
        const ack = await service.clientAckCue(connectionId(event), payload);
        return json(200, { ack });
      }

      return json(404, {
        error: {
          code: "WEBSOCKET_ROUTE_NOT_FOUND",
          message: `No WebSocket route matches ${route}.`,
        },
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}
