import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import type {
  CueJob,
  CueJobQueue,
  StoredCueJob,
  StoredSummaryJob,
  SummaryJob,
  SummaryJobQueue,
} from "../queues/types.js";

export type AwsSqsJobQueueOptions = {
  queueUrl: string;
  sqs?: SQSClient;
  tableName?: string;
  dynamodb?: DynamoDBClient;
};

type JobType = "CUE" | "SUMMARY";

type JobMarker = {
  PK: string;
  SK: string;
  entityType: "PENDING_JOB";
  jobType: JobType;
  jobId: string;
  conversationId: string;
  enqueuedAt: string;
};

function pendingJobPk(type: JobType, conversationId: string): string {
  return `PENDING_${type}_JOB#${conversationId}`;
}

function pendingJobSk(jobId: string): string {
  return `JOB#${jobId}`;
}

function jobLookupKey(jobId: string) {
  return {
    PK: `JOB#${jobId}`,
    SK: `JOB#${jobId}`,
  };
}

function pendingMarker(type: JobType, job: { jobId: string; conversationId: string; enqueuedAt: string }): JobMarker {
  return {
    PK: pendingJobPk(type, job.conversationId),
    SK: pendingJobSk(job.jobId),
    entityType: "PENDING_JOB",
    jobType: type,
    jobId: job.jobId,
    conversationId: job.conversationId,
    enqueuedAt: job.enqueuedAt,
  };
}

class PendingJobMarkers {
  private readonly dynamodb?: DynamoDBClient;

  constructor(private readonly options: AwsSqsJobQueueOptions) {
    this.dynamodb = options.tableName ? options.dynamodb ?? new DynamoDBClient({}) : undefined;
  }

  async hasPending(type: JobType, conversationId: string): Promise<boolean> {
    if (!this.dynamodb || !this.options.tableName) return false;
    const response = await this.dynamodb.send(new QueryCommand({
      TableName: this.options.tableName,
      KeyConditionExpression: "PK = :pk",
      Limit: 1,
      ExpressionAttributeValues: marshall({
        ":pk": pendingJobPk(type, conversationId),
      }),
    }));
    return Boolean(response.Items?.length);
  }

  async put(type: JobType, job: { jobId: string; conversationId: string; enqueuedAt: string }): Promise<void> {
    if (!this.dynamodb || !this.options.tableName) return;
    const marker = pendingMarker(type, job);
    await this.dynamodb.send(new PutItemCommand({
      TableName: this.options.tableName,
      Item: marshall(marker),
    }));
    await this.dynamodb.send(new PutItemCommand({
      TableName: this.options.tableName,
      Item: marshall({
        ...jobLookupKey(job.jobId),
        entityType: "PENDING_JOB_LOOKUP",
        jobType: type,
        jobId: job.jobId,
        conversationId: job.conversationId,
      }),
    }));
  }

  async delete(jobId: string): Promise<void> {
    if (!this.dynamodb || !this.options.tableName) return;
    const lookup = await this.dynamodb.send(new GetItemCommand({
      TableName: this.options.tableName,
      Key: marshall(jobLookupKey(jobId)),
    }));
    if (!lookup.Item) return;
    const item = unmarshall(lookup.Item) as { jobType?: JobType; conversationId?: string };
    if (item.jobType && item.conversationId) {
      await this.dynamodb.send(new DeleteItemCommand({
        TableName: this.options.tableName,
        Key: marshall({
          PK: pendingJobPk(item.jobType, item.conversationId),
          SK: pendingJobSk(jobId),
        }),
      }));
    }
    await this.dynamodb.send(new DeleteItemCommand({
      TableName: this.options.tableName,
      Key: marshall(jobLookupKey(jobId)),
    }));
  }
}

export class AwsCueJobQueue implements CueJobQueue {
  private readonly sqs: SQSClient;
  private readonly markers: PendingJobMarkers;

  constructor(private readonly options: AwsSqsJobQueueOptions) {
    this.sqs = options.sqs ?? new SQSClient({});
    this.markers = new PendingJobMarkers(options);
  }

  async enqueueCueJob(job: CueJob): Promise<StoredCueJob> {
    const stored: StoredCueJob = {
      ...job,
      status: "PENDING",
      attempts: 0,
    };
    await this.sqs.send(new SendMessageCommand({
      QueueUrl: this.options.queueUrl,
      MessageBody: JSON.stringify(stored),
    }));
    await this.markers.put("CUE", job);
    return stored;
  }

  async hasPendingCueJob(conversationId: string): Promise<boolean> {
    return this.markers.hasPending("CUE", conversationId);
  }

  async receiveNextCueJob(): Promise<StoredCueJob | null> {
    return null;
  }

  async completeCueJob(jobId: string): Promise<StoredCueJob | null> {
    await this.markers.delete(jobId);
    return null;
  }

  async failCueJob(jobId: string): Promise<StoredCueJob | null> {
    await this.markers.delete(jobId);
    return null;
  }
}

export class AwsSummaryJobQueue implements SummaryJobQueue {
  private readonly sqs: SQSClient;
  private readonly markers: PendingJobMarkers;

  constructor(private readonly options: AwsSqsJobQueueOptions) {
    this.sqs = options.sqs ?? new SQSClient({});
    this.markers = new PendingJobMarkers(options);
  }

  async enqueueSummaryJob(job: SummaryJob): Promise<StoredSummaryJob> {
    const stored: StoredSummaryJob = {
      ...job,
      status: "PENDING",
      attempts: 0,
    };
    await this.sqs.send(new SendMessageCommand({
      QueueUrl: this.options.queueUrl,
      MessageBody: JSON.stringify(stored),
    }));
    await this.markers.put("SUMMARY", job);
    return stored;
  }

  async hasPendingSummaryJob(conversationId: string): Promise<boolean> {
    return this.markers.hasPending("SUMMARY", conversationId);
  }

  async receiveNextSummaryJob(): Promise<StoredSummaryJob | null> {
    return null;
  }

  async completeSummaryJob(jobId: string): Promise<StoredSummaryJob | null> {
    await this.markers.delete(jobId);
    return null;
  }

  async failSummaryJob(jobId: string): Promise<StoredSummaryJob | null> {
    await this.markers.delete(jobId);
    return null;
  }
}
