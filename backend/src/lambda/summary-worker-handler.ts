import { ApiGatewayWebSocketMessenger } from "../aws/api-gateway-websocket-messenger.js";
import type { StoredSummaryJob } from "../queues/types.js";
import { SummaryWorker } from "../workers/summary-worker.js";
import { createConversationService, createStore, createSummaryQueue, prepareRuntime } from "./runtime.js";

type SqsRecord = {
  body: string;
};

type SqsEvent = {
  Records?: SqsRecord[];
};

function parseJob(record: SqsRecord): StoredSummaryJob {
  return JSON.parse(record.body) as StoredSummaryJob;
}

function webSocketManagementEndpoint(): string {
  const endpoint = process.env.CUEFLOW_WEBSOCKET_MANAGEMENT_ENDPOINT?.trim();
  if (!endpoint) throw new Error("CUEFLOW_WEBSOCKET_MANAGEMENT_ENDPOINT is required.");
  return endpoint;
}

export async function handler(event: SqsEvent) {
  await prepareRuntime();
  const store = createStore();
  const conversations = createConversationService(store);
  const worker = new SummaryWorker(
    conversations,
    store,
    createSummaryQueue(),
    new ApiGatewayWebSocketMessenger(webSocketManagementEndpoint()),
  );

  const results = [];
  for (const record of event.Records ?? []) {
    const result = await worker.processJob(parseJob(record));
    results.push(result);
    if (result.status === "FAILED") {
      throw new Error(result.error);
    }
  }
  return { results };
}
