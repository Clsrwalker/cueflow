import { ApiGatewayWebSocketMessenger } from "../aws/api-gateway-websocket-messenger.js";
import type { StoredCueJob } from "../queues/types.js";
import { CueWorker } from "../workers/cue-worker.js";
import { createCueQueue, createStore, prepareRuntime } from "./runtime.js";

type SqsRecord = {
  body: string;
};

type SqsEvent = {
  Records?: SqsRecord[];
};

function parseJob(record: SqsRecord): StoredCueJob {
  return JSON.parse(record.body) as StoredCueJob;
}

function webSocketManagementEndpoint(): string {
  const endpoint = process.env.CUEFLOW_WEBSOCKET_MANAGEMENT_ENDPOINT?.trim();
  if (!endpoint) throw new Error("CUEFLOW_WEBSOCKET_MANAGEMENT_ENDPOINT is required.");
  return endpoint;
}

export async function handler(event: SqsEvent) {
  await prepareRuntime();
  const store = createStore();
  const worker = new CueWorker(
    store,
    createCueQueue(),
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
