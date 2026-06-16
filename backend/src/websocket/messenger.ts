export type WebSocketMessenger = {
  sendToConnection(connectionId: string, event: unknown): Promise<void>;
};

export type SentWebSocketEvent = {
  connectionId: string;
  event: unknown;
};

export class InMemoryWebSocketMessenger implements WebSocketMessenger {
  private readonly sent: SentWebSocketEvent[] = [];

  async sendToConnection(connectionId: string, event: unknown): Promise<void> {
    this.sent.push({
      connectionId,
      event,
    });
  }

  sentEventsForTest(connectionId?: string): SentWebSocketEvent[] {
    return this.sent
      .filter((item) => !connectionId || item.connectionId === connectionId)
      .map((item) => ({
        connectionId: item.connectionId,
        event: item.event,
      }));
  }
}
