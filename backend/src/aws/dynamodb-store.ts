import {
  type AttributeValue,
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  chunkItemKeys,
  connectionItemKeys,
  conversationItemKeys,
  conversationPk,
  conversationSk,
  cueItemKeys,
  fullTranscriptS3Key,
  rawChunkS3Key,
  summaryS3Key,
  userPk,
  type Conversation,
  type ConversationSummary,
  type Cue,
  type TranscriptChunk,
  type WebSocketConnection,
} from "@cueflow/shared";
import type { ConversationPatch, CueFlowStore } from "../storage/types.js";

type DynamoRecord = Record<string, unknown>;

const SUMMARY_SK = "SUMMARY#latest";

function toItem(record: DynamoRecord) {
  return marshall(record, { removeUndefinedValues: true });
}

function fromItem<T>(item: Record<string, AttributeValue> | undefined): T | null {
  return item ? (unmarshall(item) as T) : null;
}

function conversationLookupKeys(conversationId: string) {
  return {
    PK: conversationPk(conversationId),
    SK: conversationSk(conversationId),
  };
}

function connectionLookupKeys(connectionId: string) {
  return {
    PK: `CONNECTION#${connectionId}`,
    SK: `CONNECTION#${connectionId}`,
  };
}

function summaryKeys(conversationId: string) {
  return {
    PK: conversationPk(conversationId),
    SK: SUMMARY_SK,
  };
}

function conversationRecord(conversation: Conversation, keys: { PK: string; SK: string }, gsi?: { GSI1PK: string; GSI1SK: string }): DynamoRecord {
  return {
    ...keys,
    ...gsi,
    entityType: "CONVERSATION",
    conversationId: conversation.conversationId,
    userId: conversation.userId,
    status: conversation.status,
    startedAt: conversation.startedAt,
    endedAt: conversation.endedAt ?? null,
    cueCount: conversation.cueCount,
    summaryStatus: conversation.summaryStatus,
    usedPrenote: conversation.usedPrenote,
  };
}

function asConversation(record: DynamoRecord | null): Conversation | null {
  if (!record) return null;
  return {
    conversationId: String(record.conversationId),
    userId: String(record.userId),
    status: record.status as Conversation["status"],
    startedAt: String(record.startedAt),
    endedAt: typeof record.endedAt === "string" ? record.endedAt : null,
    cueCount: Number(record.cueCount ?? 0),
    summaryStatus: record.summaryStatus as Conversation["summaryStatus"],
    usedPrenote: typeof record.usedPrenote === "object" && record.usedPrenote !== null
      ? {
          id: String((record.usedPrenote as { id?: unknown }).id ?? ""),
          title: String((record.usedPrenote as { title?: unknown }).title ?? ""),
          text: String((record.usedPrenote as { text?: unknown }).text ?? ""),
        }
      : undefined,
  };
}

function transcriptChunkRecord(chunk: TranscriptChunk): DynamoRecord {
  return {
    ...chunkItemKeys(chunk.conversationId, chunk.chunkId),
    entityType: "TRANSCRIPT_CHUNK",
    conversationId: chunk.conversationId,
    chunkId: chunk.chunkId,
    speaker: chunk.speaker,
    text: chunk.text,
    clientTimestamp: chunk.clientTimestamp,
    createdAt: chunk.createdAt,
    s3Key: chunk.s3Key,
  };
}

function asTranscriptChunk(record: DynamoRecord): TranscriptChunk {
  return {
    conversationId: String(record.conversationId),
    chunkId: String(record.chunkId),
    speaker: String(record.speaker),
    text: String(record.text),
    clientTimestamp: typeof record.clientTimestamp === "string" ? record.clientTimestamp : undefined,
    createdAt: String(record.createdAt),
    s3Key: typeof record.s3Key === "string" ? record.s3Key : undefined,
  };
}

function cueRecord(cue: Cue): DynamoRecord {
  return {
    ...cueItemKeys(cue.conversationId, cue.createdAt, cue.cueId),
    entityType: "CUE",
    conversationId: cue.conversationId,
    cueId: cue.cueId,
    type: cue.type,
    title: cue.title,
    shortText: cue.shortText,
    detailText: cue.detailText,
    sourceChunkStart: cue.sourceChunkStart,
    sourceChunkEnd: cue.sourceChunkEnd,
    confidence: cue.confidence,
    createdAt: cue.createdAt,
    modelLatencyMs: cue.modelLatencyMs,
  };
}

function asCue(record: DynamoRecord): Cue {
  return {
    conversationId: String(record.conversationId),
    cueId: String(record.cueId),
    type: record.type as Cue["type"],
    title: String(record.title),
    shortText: String(record.shortText),
    detailText: String(record.detailText),
    sourceChunkStart: String(record.sourceChunkStart),
    sourceChunkEnd: String(record.sourceChunkEnd),
    confidence: Number(record.confidence ?? 0),
    createdAt: String(record.createdAt),
    modelLatencyMs: typeof record.modelLatencyMs === "number" ? record.modelLatencyMs : undefined,
  };
}

function connectionRecord(connection: WebSocketConnection, keys: { PK: string; SK: string }): DynamoRecord {
  return {
    ...keys,
    entityType: "WEBSOCKET_CONNECTION",
    connectionId: connection.connectionId,
    conversationId: connection.conversationId,
    userId: connection.userId,
    connectedAt: connection.connectedAt,
    ttl: connection.ttl,
  };
}

function asConnection(record: DynamoRecord | null): WebSocketConnection | null {
  if (!record) return null;
  return {
    connectionId: String(record.connectionId),
    conversationId: String(record.conversationId),
    userId: String(record.userId),
    connectedAt: String(record.connectedAt),
    ttl: typeof record.ttl === "number" ? record.ttl : undefined,
  };
}

function summaryRecord(summary: ConversationSummary, s3Key: string): DynamoRecord {
  return {
    ...summaryKeys(summary.conversationId),
    entityType: "SUMMARY",
    conversationId: summary.conversationId,
    createdAt: summary.createdAt,
    s3Key,
    keyTopicCount: summary.keyTopics.length,
    actionItemCount: summary.actionItems.length,
    riskCount: summary.risks.length,
  };
}

function asSummary(record: DynamoRecord | null): ConversationSummary | null {
  if (!record) return null;
  return {
    conversationId: String(record.conversationId),
    summary: String(record.summary),
    keyTopics: Array.isArray(record.keyTopics) ? record.keyTopics.map(String) : [],
    actionItems: Array.isArray(record.actionItems) ? record.actionItems.map(String) : [],
    risks: Array.isArray(record.risks) ? record.risks.map(String) : [],
    createdAt: String(record.createdAt),
  };
}

export type AwsCueFlowStoreOptions = {
  tableName: string;
  dataBucketName: string;
  dynamodb?: DynamoDBClient;
  s3?: S3Client;
};

export class AwsCueFlowStore implements CueFlowStore {
  private readonly dynamodb: DynamoDBClient;
  private readonly s3: S3Client;

  constructor(private readonly options: AwsCueFlowStoreOptions) {
    this.dynamodb = options.dynamodb ?? new DynamoDBClient({});
    this.s3 = options.s3 ?? new S3Client({});
  }

  async createConversation(conversation: Conversation): Promise<Conversation> {
    const userKeys = conversationItemKeys({
      userId: conversation.userId,
      conversationId: conversation.conversationId,
      startedAt: conversation.startedAt,
    });
    await this.putRecord(conversationRecord(conversation, userKeys, {
      GSI1PK: userKeys.GSI1PK,
      GSI1SK: userKeys.GSI1SK,
    }));
    await this.putRecord(conversationRecord(conversation, conversationLookupKeys(conversation.conversationId)));
    return conversation;
  }

  async listConversations(userId: string): Promise<Conversation[]> {
    const response = await this.dynamodb.send(new QueryCommand({
      TableName: this.options.tableName,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: toItem({
        ":pk": userPk(userId),
        ":prefix": "CONV#",
      }),
    }));

    return (response.Items ?? [])
      .map((item) => asConversation(unmarshall(item)))
      .filter((item): item is Conversation => Boolean(item))
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async getConversation(conversationId: string): Promise<Conversation | null> {
    const record = await this.getRecord(conversationLookupKeys(conversationId));
    return asConversation(record);
  }

  async updateConversation(conversationId: string, patch: ConversationPatch): Promise<Conversation | null> {
    const current = await this.getConversation(conversationId);
    if (!current) return null;
    const next: Conversation = {
      ...current,
      ...patch,
    };
    const userKeys = conversationItemKeys({
      userId: next.userId,
      conversationId: next.conversationId,
      startedAt: next.startedAt,
    });
    await this.putRecord(conversationRecord(next, userKeys, {
      GSI1PK: userKeys.GSI1PK,
      GSI1SK: userKeys.GSI1SK,
    }));
    await this.putRecord(conversationRecord(next, conversationLookupKeys(next.conversationId)));
    return next;
  }

  async putTranscriptChunk(chunk: TranscriptChunk): Promise<TranscriptChunk> {
    await this.putRecord(transcriptChunkRecord(chunk));
    return chunk;
  }

  async listTranscriptChunks(conversationId: string): Promise<TranscriptChunk[]> {
    const response = await this.dynamodb.send(new QueryCommand({
      TableName: this.options.tableName,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: toItem({
        ":pk": conversationPk(conversationId),
        ":prefix": "CHUNK#",
      }),
    }));

    return (response.Items ?? [])
      .map((item) => asTranscriptChunk(unmarshall(item)))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async putCue(cue: Cue): Promise<Cue> {
    await this.putRecord(cueRecord(cue));
    const conversation = await this.getConversation(cue.conversationId);
    if (conversation) {
      await this.updateConversation(cue.conversationId, {
        cueCount: conversation.cueCount + 1,
      });
    }
    return cue;
  }

  async listCues(conversationId: string): Promise<Cue[]> {
    const response = await this.dynamodb.send(new QueryCommand({
      TableName: this.options.tableName,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: toItem({
        ":pk": conversationPk(conversationId),
        ":prefix": "CUE#",
      }),
    }));

    return (response.Items ?? [])
      .map((item) => asCue(unmarshall(item)))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async putConnection(connection: WebSocketConnection): Promise<WebSocketConnection> {
    await this.putRecord(connectionRecord(connection, connectionItemKeys(connection.conversationId, connection.connectionId)));
    await this.putRecord(connectionRecord(connection, connectionLookupKeys(connection.connectionId)));
    return connection;
  }

  async getConnection(connectionId: string): Promise<WebSocketConnection | null> {
    const record = await this.getRecord(connectionLookupKeys(connectionId));
    return asConnection(record);
  }

  async deleteConnection(connectionId: string): Promise<WebSocketConnection | null> {
    const connection = await this.getConnection(connectionId);
    if (!connection) return null;
    await this.deleteRecord(connectionLookupKeys(connectionId));
    await this.deleteRecord(connectionItemKeys(connection.conversationId, connectionId));
    return connection;
  }

  async listConnections(conversationId: string): Promise<WebSocketConnection[]> {
    const response = await this.dynamodb.send(new QueryCommand({
      TableName: this.options.tableName,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: toItem({
        ":pk": conversationPk(conversationId),
        ":prefix": "CONNECTION#",
      }),
    }));

    return (response.Items ?? [])
      .map((item) => asConnection(unmarshall(item)))
      .filter((item): item is WebSocketConnection => Boolean(item));
  }

  async putRawTranscriptChunk(chunk: TranscriptChunk): Promise<string> {
    const key = rawChunkS3Key(chunk.conversationId, chunk.chunkId);
    await this.putObject(key, chunk);
    return key;
  }

  async putFullTranscript(conversationId: string, chunks: TranscriptChunk[]): Promise<string> {
    const key = fullTranscriptS3Key(conversationId);
    await this.putObject(key, {
      conversationId,
      chunks,
      generatedAt: new Date().toISOString(),
    });
    return key;
  }

  async putSummary(summary: ConversationSummary): Promise<string> {
    const key = summaryS3Key(summary.conversationId);
    await this.putObject(key, summary);
    await this.putRecord(summaryRecord(summary, key));
    return key;
  }

  async getSummary(conversationId: string): Promise<ConversationSummary | null> {
    const record = await this.getRecord(summaryKeys(conversationId));
    if (!record) return null;
    const s3Key = typeof record.s3Key === "string" ? record.s3Key : "";
    if (!s3Key) return asSummary(record);
    return this.getObject<ConversationSummary>(s3Key);
  }

  private async getRecord(key: { PK: string; SK: string }): Promise<DynamoRecord | null> {
    const response = await this.dynamodb.send(new GetItemCommand({
      TableName: this.options.tableName,
      Key: toItem(key),
    }));
    return fromItem<DynamoRecord>(response.Item);
  }

  private async putRecord(record: DynamoRecord): Promise<void> {
    await this.dynamodb.send(new PutItemCommand({
      TableName: this.options.tableName,
      Item: toItem(record),
    }));
  }

  private async deleteRecord(key: { PK: string; SK: string }): Promise<void> {
    await this.dynamodb.send(new DeleteItemCommand({
      TableName: this.options.tableName,
      Key: toItem(key),
    }));
  }

  private async putObject(key: string, value: unknown): Promise<void> {
    await this.s3.send(new PutObjectCommand({
      Bucket: this.options.dataBucketName,
      Key: key,
      Body: JSON.stringify(value),
      ContentType: "application/json; charset=utf-8",
    }));
  }

  private async getObject<T>(key: string): Promise<T | null> {
    const response = await this.s3.send(new GetObjectCommand({
      Bucket: this.options.dataBucketName,
      Key: key,
    }));
    const body = await response.Body?.transformToString();
    return body ? JSON.parse(body) as T : null;
  }
}
