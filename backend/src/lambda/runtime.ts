import { randomUUID } from "node:crypto";
import { AwsCueFlowStore } from "../aws/dynamodb-store.js";
import { AwsCueJobQueue, AwsSummaryJobQueue } from "../aws/sqs-job-queues.js";
import { configureOpenAiFromSecret } from "../aws/openai-secret.js";
import { OpenAiTranscriptionProvider } from "../ai/transcription-provider.js";
import { ConversationService } from "../services/conversation-service.js";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function idFactory(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

export async function prepareRuntime(): Promise<void> {
  await configureOpenAiFromSecret();
}

export function createStore(): AwsCueFlowStore {
  return new AwsCueFlowStore({
    tableName: requiredEnv("CUEFLOW_TABLE_NAME"),
    dataBucketName: requiredEnv("CUEFLOW_DATA_BUCKET_NAME"),
  });
}

export function createCueQueue(): AwsCueJobQueue {
  return new AwsCueJobQueue({
    queueUrl: requiredEnv("CUEFLOW_CUE_QUEUE_URL"),
    tableName: requiredEnv("CUEFLOW_TABLE_NAME"),
  });
}

export function createSummaryQueue(): AwsSummaryJobQueue {
  return new AwsSummaryJobQueue({
    queueUrl: requiredEnv("CUEFLOW_SUMMARY_QUEUE_URL"),
    tableName: requiredEnv("CUEFLOW_TABLE_NAME"),
  });
}

export function createConversationService(store = createStore()): ConversationService {
  return new ConversationService(store, { idFactory });
}

export function createTranscriber(): OpenAiTranscriptionProvider {
  return new OpenAiTranscriptionProvider();
}

export function lambdaResponse(statusCode: number, payload: unknown) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type,authorization,x-cueflow-user-id",
      "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    },
    body: statusCode === 204 ? "" : JSON.stringify(payload),
  };
}
