import type { CueCreatedEvent, SummaryReadyEvent } from "@cueflow/shared";
import type { CueFlowStore } from "../storage/types.js";
import type { WebSocketMessenger } from "../websocket/messenger.js";

export type WorkerPushEvent = CueCreatedEvent | SummaryReadyEvent;

export async function publishToConversationConnections(
  store: CueFlowStore,
  messenger: WebSocketMessenger,
  conversationId: string,
  event: WorkerPushEvent,
): Promise<number> {
  const connections = await store.listConnections(conversationId);
  let delivered = 0;

  for (const connection of connections) {
    try {
      await messenger.sendToConnection(connection.connectionId, event);
      delivered += 1;
    } catch {
      await store.deleteConnection(connection.connectionId);
    }
  }

  return delivered;
}
