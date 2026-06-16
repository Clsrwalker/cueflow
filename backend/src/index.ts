export type {
  Conversation,
  ConversationSummary,
  Cue,
  TranscriptChunk,
  WebSocketSendTranscriptMessage,
} from "@cueflow/shared";

export {
  chunkItemKeys,
  connectionItemKeys,
  conversationItemKeys,
  cueItemKeys,
  fullTranscriptS3Key,
  rawChunkS3Key,
  summaryS3Key,
  validateSendTranscriptMessage,
} from "@cueflow/shared";

export {
  DECISION_AND_RISK_KEYWORDS,
  evaluateCueTrigger,
  TRIGGER_COOLDOWN_MS,
  TRIGGER_WORD_THRESHOLD,
  type CueTriggerEvaluation,
  type CueTriggerInput,
  type CueTriggerReason,
} from "./domain/cue-trigger.js";

export {
  buildSummaryFromTranscript,
  type SummaryBuilderResult,
} from "./ai/summary-builder.js";

export {
  MockAiProvider,
} from "./ai/mock-ai-provider.js";

export {
  DEFAULT_USER_ID,
  ConversationClosedError,
  ConversationNotFoundError,
  ConversationService,
  ConversationServiceError,
  InvalidConversationInputError,
  SummaryNotReadyError,
  type AppendTranscriptChunkInput,
  type ConversationServiceOptions,
  type CreateConversationInput,
  type EndConversationResult,
  type ListConversationsInput,
  type RecordCueInput,
} from "./services/conversation-service.js";

export {
  createRestHandler,
  type RestRequest,
  type RestResponse,
} from "./handlers/rest.js";

export {
  createWebSocketHandler,
  type WebSocketRequest,
  type WebSocketResponse,
} from "./handlers/websocket.js";

export {
  InMemoryCueFlowStore,
} from "./storage/in-memory-store.js";

export {
  InMemoryCueJobQueue,
} from "./queues/in-memory-cue-job-queue.js";

export type {
  CueJob,
  CueJobQueue,
  CueJobStatus,
  StoredCueJob,
} from "./queues/types.js";

export {
  InMemoryWebSocketMessenger,
} from "./websocket/messenger.js";

export type {
  SentWebSocketEvent,
  WebSocketMessenger,
} from "./websocket/messenger.js";

export {
  WebSocketConnectionNotFoundError,
  WebSocketService,
  WebSocketServiceError,
  WebSocketValidationError,
  toWebSocketServiceError,
  type ClientAckCueResult,
  type ConnectInput,
  type SendTranscriptResult,
  type WebSocketServiceOptions,
} from "./websocket/websocket-service.js";

export type {
  ConversationPatch,
  CueFlowStore,
  MetadataStore,
  ObjectStore,
} from "./storage/types.js";

export type {
  AiProvider,
  CueContextWindow,
  CueProviderResult,
  SummaryProviderResult,
} from "./ai/types.js";
