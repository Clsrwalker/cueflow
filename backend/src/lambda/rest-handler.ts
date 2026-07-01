import { createRestHandler, type RestRequest } from "../handlers/rest.js";
import { createConversationService, createStore, createSummaryQueue, createTranscriber, prepareRuntime } from "./runtime.js";

export async function handler(event: RestRequest) {
  await prepareRuntime();
  const store = createStore();
  const conversations = createConversationService(store);
  const restHandler = createRestHandler(conversations, {
    summaryQueue: createSummaryQueue(),
    transcriber: createTranscriber(),
  });
  return restHandler(event);
}
