export type DynamoKey = {
  PK: string;
  SK: string;
};

export type ConversationItemKeys = DynamoKey & {
  GSI1PK: string;
  GSI1SK: string;
};

function requireKeyPart(name: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${name} is required`);
  }
  if (trimmed.includes("#")) {
    throw new Error(`${name} must not contain #`);
  }
  return trimmed;
}

export function userPk(userId: string): string {
  return `USER#${requireKeyPart("userId", userId)}`;
}

export function conversationPk(conversationId: string): string {
  return `CONV#${requireKeyPart("conversationId", conversationId)}`;
}

export function conversationSk(conversationId: string): string {
  return `CONV#${requireKeyPart("conversationId", conversationId)}`;
}

export function chunkSk(chunkId: string): string {
  return `CHUNK#${requireKeyPart("chunkId", chunkId)}`;
}

export function cueSk(createdAt: string, cueId: string): string {
  return `CUE#${requireKeyPart("createdAt", createdAt)}#${requireKeyPart("cueId", cueId)}`;
}

export function connectionSk(connectionId: string): string {
  return `CONNECTION#${requireKeyPart("connectionId", connectionId)}`;
}

export function conversationItemKeys(params: {
  userId: string;
  conversationId: string;
  startedAt: string;
}): ConversationItemKeys {
  return {
    PK: userPk(params.userId),
    SK: conversationSk(params.conversationId),
    GSI1PK: userPk(params.userId),
    GSI1SK: requireKeyPart("startedAt", params.startedAt),
  };
}

export function chunkItemKeys(conversationId: string, chunkId: string): DynamoKey {
  return {
    PK: conversationPk(conversationId),
    SK: chunkSk(chunkId),
  };
}

export function cueItemKeys(conversationId: string, createdAt: string, cueId: string): DynamoKey {
  return {
    PK: conversationPk(conversationId),
    SK: cueSk(createdAt, cueId),
  };
}

export function connectionItemKeys(conversationId: string, connectionId: string): DynamoKey {
  return {
    PK: conversationPk(conversationId),
    SK: connectionSk(connectionId),
  };
}

export function rawChunkS3Key(conversationId: string, chunkId: string): string {
  return `raw/${requireKeyPart("conversationId", conversationId)}/chunks/${requireKeyPart("chunkId", chunkId)}.json`;
}

export function fullTranscriptS3Key(conversationId: string): string {
  return `raw/${requireKeyPart("conversationId", conversationId)}/full-transcript.json`;
}

export function summaryS3Key(conversationId: string): string {
  return `summaries/${requireKeyPart("conversationId", conversationId)}/summary.json`;
}

