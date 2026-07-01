import { ApiGatewayWebSocketMessenger, managementEndpointFromEvent } from "../aws/api-gateway-websocket-messenger.js";
import { createWebSocketHandler, type WebSocketRequest } from "../handlers/websocket.js";
import { WebSocketService } from "../websocket/websocket-service.js";
import { createConversationService, createCueQueue, createStore, prepareRuntime } from "./runtime.js";

export async function handler(event: WebSocketRequest) {
  await prepareRuntime();
  const store = createStore();
  const conversations = createConversationService(store);
  const messenger = new ApiGatewayWebSocketMessenger(managementEndpointFromEvent(event));
  const service = new WebSocketService(conversations, store, createCueQueue(), messenger);
  return createWebSocketHandler(service)(event);
}
