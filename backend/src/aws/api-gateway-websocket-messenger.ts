import {
  ApiGatewayManagementApiClient,
  DeleteConnectionCommand,
  GoneException,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import type { WebSocketMessenger } from "../websocket/messenger.js";

export class ApiGatewayWebSocketMessenger implements WebSocketMessenger {
  private readonly client: ApiGatewayManagementApiClient;

  constructor(endpoint: string) {
    this.client = new ApiGatewayManagementApiClient({ endpoint });
  }

  async sendToConnection(connectionId: string, event: unknown): Promise<void> {
    try {
      await this.client.send(new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify(event)),
      }));
    } catch (error) {
      if (error instanceof GoneException) {
        throw error;
      }
      throw error;
    }
  }

  async deleteConnection(connectionId: string): Promise<void> {
    await this.client.send(new DeleteConnectionCommand({ ConnectionId: connectionId }));
  }
}

export function managementEndpointFromEvent(event: {
  requestContext?: {
    domainName?: string;
    stage?: string;
  };
}): string {
  const domainName = event.requestContext?.domainName;
  const stage = event.requestContext?.stage;
  if (!domainName || !stage) {
    throw new Error("WebSocket requestContext domainName and stage are required.");
  }
  return `https://${domainName}/${stage}`;
}
