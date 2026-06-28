import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sqs from "aws-cdk-lib/aws-sqs";

const app = new cdk.App();
app.node.setContext("@aws-cdk/core:defaultCrossStackReferences", "strong");
const stage = app.node.tryGetContext("stage") ?? "dev";
const bootstrapless = app.node.tryGetContext("bootstrapless") === "true";
const labRoleArn = app.node.tryGetContext("labRoleArn") as string | undefined;
const skipFrontend = app.node.tryGetContext("skipFrontend") === "true";
const frontendMode = (app.node.tryGetContext("frontendMode") ?? "cloudfront") as "cloudfront" | "s3-website" | "api-static";
if (!["cloudfront", "s3-website", "api-static"].includes(frontendMode)) {
  throw new Error(`Unsupported frontendMode: ${frontendMode}`);
}
const openAiSecretId =
  (app.node.tryGetContext("openAiSecretId") as string | undefined) ?? process.env.OPENAI_SECRET_ID ?? `cueflow/${stage}/openai-api-key`;
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

type CueFlowStackProps = cdk.StackProps & {
  stage: string;
  autoDeleteObjects?: boolean;
};

type FrontendMode = "cloudfront" | "s3-website" | "api-static";

type FrontendHostingStackProps = CueFlowStackProps & {
  mode: FrontendMode;
  lambdaRoleArn?: string;
  openAiSecretId?: string;
  tableName?: string;
};

class StorageStack extends cdk.Stack {
  readonly table: dynamodb.Table;
  readonly dataBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: CueFlowStackProps) {
    super(scope, id, props);

    this.table = new dynamodb.Table(this, "CueFlowTable", {
      tableName: `CueFlowTable-${props.stage}`,
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.dataBucket = new s3.Bucket(this, "CueFlowDataBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [
        {
          id: "ExpireDemoTranscriptObjects",
          enabled: true,
          prefix: "raw/",
          expiration: cdk.Duration.days(30),
        },
        {
          id: "ExpireDemoSummaryObjects",
          enabled: true,
          prefix: "summaries/",
          expiration: cdk.Duration.days(30),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: props.autoDeleteObjects ?? true,
    });

    new cdk.CfnOutput(this, "CueFlowTableName", { value: this.table.tableName });
    new cdk.CfnOutput(this, "CueFlowDataBucketName", { value: this.dataBucket.bucketName });
  }
}

class QueueStack extends cdk.Stack {
  readonly cueQueue: sqs.Queue;
  readonly cueDlq: sqs.Queue;
  readonly summaryQueue: sqs.Queue;
  readonly summaryDlq: sqs.Queue;

  constructor(scope: Construct, id: string, props: CueFlowStackProps) {
    super(scope, id, props);

    this.cueDlq = new sqs.Queue(this, "CueDlq", {
      queueName: `cueflow-cue-dlq-${props.stage}`,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: cdk.Duration.days(14),
    });

    this.cueQueue = new sqs.Queue(this, "CueQueue", {
      queueName: `cueflow-cue-queue-${props.stage}`,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      visibilityTimeout: cdk.Duration.seconds(45),
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: {
        queue: this.cueDlq,
        maxReceiveCount: 3,
      },
    });

    this.summaryDlq = new sqs.Queue(this, "SummaryDlq", {
      queueName: `cueflow-summary-dlq-${props.stage}`,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: cdk.Duration.days(14),
    });

    this.summaryQueue = new sqs.Queue(this, "SummaryQueue", {
      queueName: `cueflow-summary-queue-${props.stage}`,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      visibilityTimeout: cdk.Duration.minutes(2),
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: {
        queue: this.summaryDlq,
        maxReceiveCount: 3,
      },
    });

    new cdk.CfnOutput(this, "CueQueueUrl", { value: this.cueQueue.queueUrl });
    new cdk.CfnOutput(this, "SummaryQueueUrl", { value: this.summaryQueue.queueUrl });
  }
}

class FrontendHostingStack extends cdk.Stack {
  readonly frontendBucket: s3.Bucket;
  readonly distribution?: cloudfront.Distribution;
  readonly httpsApi?: apigwv2.HttpApi;
  readonly assetServer?: lambda.Function;
  readonly aiProxy?: lambda.Function;
  readonly prenoteApi?: lambda.Function;

  constructor(scope: Construct, id: string, props: FrontendHostingStackProps) {
    super(scope, id, props);

    const useS3Website = props.mode === "s3-website";
    const useApiStatic = props.mode === "api-static";
    const usePublicBucket = useS3Website || useApiStatic;
    this.frontendBucket = new s3.Bucket(this, "FrontendBucket", {
      blockPublicAccess: usePublicBucket
        ? new s3.BlockPublicAccess({
            blockPublicAcls: false,
            ignorePublicAcls: false,
            blockPublicPolicy: false,
            restrictPublicBuckets: false,
          })
        : s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: !useS3Website,
      publicReadAccess: usePublicBucket,
      websiteIndexDocument: useS3Website ? "index.html" : undefined,
      websiteErrorDocument: useS3Website ? "index.html" : undefined,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: props.autoDeleteObjects ?? true,
    });

    if (props.mode === "cloudfront") {
      this.distribution = new cloudfront.Distribution(this, "FrontendDistribution", {
        defaultRootObject: "index.html",
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(this.frontendBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        errorResponses: [
          { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html" },
          { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html" },
        ],
      });
    }

    if (useApiStatic) {
      const lambdaRole = props.lambdaRoleArn
        ? iam.Role.fromRoleArn(this, "LearnerLabFrontendRole", props.lambdaRoleArn, { mutable: false })
        : undefined;
      const physicalName = `cueflow-frontend-site-${props.stage}`;
      const logGroup = new logs.LogGroup(this, "FrontendAssetServerLogGroup", {
        logGroupName: `/aws/lambda/${physicalName}`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      this.assetServer = new lambda.Function(this, "FrontendAssetServer", {
        functionName: physicalName,
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "index.handler",
        memorySize: 128,
        timeout: cdk.Duration.seconds(10),
        logGroup,
        role: lambdaRole,
        environment: {
          FRONTEND_BUCKET_NAME: this.frontendBucket.bucketName,
          FRONTEND_REGION: cdk.Stack.of(this).region,
        },
        code: lambda.Code.fromInline(`
const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

exports.handler = async (event) => {
  const rawPath = event.rawPath || "/";
  let key = decodeURIComponent(rawPath).replace(/^\\/+/, "");
  if (!key || key.endsWith("/")) {
    key = key + "index.html";
  }

  const response = await readAsset(key);
  if (response.statusCode === 403 || response.statusCode === 404) {
    const acceptsHtml = String(event.headers?.accept || "").includes("text/html");
    if (!key.includes(".") || acceptsHtml) {
      return readAsset("index.html", 200);
    }
  }
  return response;
};

async function readAsset(key, overrideStatusCode) {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const url = "https://" + process.env.FRONTEND_BUCKET_NAME + ".s3." + process.env.FRONTEND_REGION + ".amazonaws.com/" + encodedKey;
  const response = await fetch(url);
  if (!response.ok) {
    return {
      statusCode: response.status,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      body: "Not found",
    };
  }

  return {
    statusCode: overrideStatusCode || response.status,
    headers: {
      "content-type": contentType(key),
      "cache-control": key === "index.html" ? "no-store" : "public, max-age=31536000, immutable",
    },
    body: await response.text(),
  };
}

function contentType(key) {
  const extension = key.includes(".") ? key.slice(key.lastIndexOf(".")) : "";
  return CONTENT_TYPES[extension] || "application/octet-stream";
}
`),
      });

      const aiProxyPhysicalName = `cueflow-ai-proxy-${props.stage}`;
      const aiProxyOpenAiSecretId = props.openAiSecretId ?? `cueflow/${props.stage}/openai-api-key`;
      const aiProxyLogGroup = new logs.LogGroup(this, "AiProxyLogGroup", {
        logGroupName: `/aws/lambda/${aiProxyPhysicalName}`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      this.aiProxy = new lambda.Function(this, "AiProxy", {
        functionName: aiProxyPhysicalName,
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "index.handler",
        memorySize: 256,
        timeout: cdk.Duration.seconds(30),
        logGroup: aiProxyLogGroup,
        role: lambdaRole,
        environment: {
          OPENAI_SECRET_ID: aiProxyOpenAiSecretId,
          OPENAI_MODEL: process.env.OPENAI_MODEL ?? "gpt-5.4-nano",
          OPENAI_SUMMARY_MODEL: process.env.OPENAI_SUMMARY_MODEL ?? "gpt-5.5",
        },
        code: lambda.Code.fromInline(`
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const secretsManager = new SecretsManagerClient({});
let cachedOpenAiApiKey = "";

const JSON_HEADERS = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST,OPTIONS",
};

const CUE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["category", "confidence", "title", "output", "reason"],
  properties: {
    category: { type: "string", enum: ["response", "concept", "suggestion", "person", "none"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    title: { type: "string" },
    output: { type: "string" },
    reason: { type: "string" },
  },
};

const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "overview", "keyPoints", "actionItems"],
  properties: {
    title: { type: "string" },
    overview: { type: "string" },
    keyPoints: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "details"],
        properties: {
          title: { type: "string" },
          details: { type: "array", items: { type: "string" } },
        },
      },
    },
    actionItems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: {
          text: { type: "string" },
        },
      },
    },
  },
};

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "POST";
  if (method === "OPTIONS") {
    return json(204, {});
  }
  if (method !== "POST") {
    return json(405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } });
  }

  const path = event.rawPath || event.path || "";
  const task = path.endsWith("/summary") ? "summary" : path.endsWith("/cue") ? "cue" : "";
  if (!task) {
    return json(404, { error: { code: "ROUTE_NOT_FOUND", message: "Unknown AI proxy route." } });
  }

  let apiKey = "";
  try {
    apiKey = await getOpenAiApiKey();
  } catch (error) {
    console.error(JSON.stringify({
      eventName: "cueflow.openai_secret_failed",
      message: error instanceof Error ? error.message : String(error),
    }));
    return json(500, { error: { code: "AI_NOT_CONFIGURED", message: "OpenAI API key could not be loaded." } });
  }

  if (!apiKey) {
    return json(500, { error: { code: "AI_NOT_CONFIGURED", message: "OpenAI API key is not configured on Lambda." } });
  }

  let body;
  try {
    const rawBody = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "{}";
    body = JSON.parse(rawBody);
  } catch {
    return json(400, { error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } });
  }

  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return json(400, { error: { code: "PROMPT_REQUIRED", message: "prompt is required." } });
  }

  try {
    const result = await generateJson(task, prompt, apiKey);
    return json(200, task === "summary" ? { summary: result } : { cue: result });
  } catch (error) {
    console.error(JSON.stringify({
      eventName: "cueflow.ai_proxy_failed",
      task,
      message: error instanceof Error ? error.message : String(error),
    }));
    return json(502, { error: { code: "OPENAI_REQUEST_FAILED", message: "AI generation failed." } });
  }
};

async function getOpenAiApiKey() {
  if (cachedOpenAiApiKey) {
    return cachedOpenAiApiKey;
  }

  const directApiKey = typeof process.env.OPENAI_API_KEY === "string" ? process.env.OPENAI_API_KEY.trim() : "";
  if (directApiKey) {
    cachedOpenAiApiKey = directApiKey;
    return cachedOpenAiApiKey;
  }

  const secretId = typeof process.env.OPENAI_SECRET_ID === "string" ? process.env.OPENAI_SECRET_ID.trim() : "";
  if (!secretId) {
    return "";
  }

  const response = await secretsManager.send(new GetSecretValueCommand({ SecretId: secretId }));
  const secretText =
    typeof response.SecretString === "string"
      ? response.SecretString
      : response.SecretBinary
        ? Buffer.from(response.SecretBinary).toString("utf8")
        : "";
  cachedOpenAiApiKey = extractOpenAiApiKey(secretText);
  return cachedOpenAiApiKey;
}

function extractOpenAiApiKey(secretText) {
  const raw = String(secretText || "").trim();
  if (!raw) {
    return "";
  }

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") {
      return parsed.trim();
    }
    for (const field of ["OPENAI_API_KEY", "openaiApiKey", "openai_api_key", "apiKey", "key"]) {
      if (typeof parsed?.[field] === "string" && parsed[field].trim()) {
        return parsed[field].trim();
      }
    }
  } catch {
    // Plain-text secrets are supported.
  }

  return raw;
}

async function generateJson(task, prompt, apiKey) {
  const isSummary = task === "summary";
  const system = isSummary
    ? [
        "You create CueFlow conversation summaries.",
        "Ground summaries in transcript facts. Use prepared notes only as background context.",
        "Return valid JSON only. Do not include markdown, explanation, or extra text.",
      ].join("\\n")
    : [
        "You are CueFlow's high-precision automatic cue generator for live conversations.",
        "Create one useful cue for the latest transcript window.",
        "Prefer category response for a direct question or request.",
        "Use category concept for a useful knowledge point, suggestion for a concrete next step or trade-off, person for explicit people or role details, and none only for noise or weak context.",
        "Use selected prenote as background only when directly relevant. Do not invent facts outside the transcript.",
        "Return valid JSON only. Do not include markdown, explanation, or extra text.",
      ].join("\\n");

  const requestBody = {
    model: isSummary
      ? process.env.OPENAI_SUMMARY_MODEL || process.env.OPENAI_MODEL || "gpt-5.5"
      : process.env.OPENAI_MODEL || "gpt-5.4-nano",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: system + "\\n\\n" + prompt,
          },
        ],
      },
    ],
    max_output_tokens: isSummary ? 1200 : 500,
    text: {
      format: {
        type: "json_schema",
        name: isSummary ? "cueflow_summary" : "cueflow_cue",
        strict: true,
        schema: isSummary ? SUMMARY_SCHEMA : CUE_SCHEMA,
      },
    },
  };
  if (!isSummary) {
    requestBody.temperature = 0.05;
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + apiKey,
    },
    body: JSON.stringify(requestBody),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error("OpenAI request failed: " + response.status + " " + text.slice(0, 500));
  }
  const data = await response.json();
  const output = extractResponseText(data);
  return JSON.parse(extractJsonObject(output));
}

function extractResponseText(data) {
  if (typeof data.output_text === "string") return data.output_text.trim();
  const texts = [];
  for (const item of data.output || []) {
    for (const contentItem of item.content || []) {
      if (typeof contentItem.text === "string") texts.push(contentItem.text);
    }
  }
  return texts.join("\\n").trim();
}

function extractJsonObject(text) {
  const fence = String.fromCharCode(96, 96, 96);
  const cleaned = String(text || "")
    .replace(new RegExp(fence + "json\\\\n?", "gi"), "")
    .replace(new RegExp(fence + "\\\\n?", "g"), "")
    .trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  return firstBrace >= 0 && lastBrace > firstBrace ? cleaned.slice(firstBrace, lastBrace + 1) : cleaned;
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: statusCode === 204 ? "" : JSON.stringify(payload),
  };
}
`),
      });

      const prenoteApiPhysicalName = `cueflow-prenote-api-${props.stage}`;
      const prenoteTableName = props.tableName ?? `CueFlowTable-${props.stage}`;
      const prenoteApiLogGroup = new logs.LogGroup(this, "PrenoteApiLogGroup", {
        logGroupName: `/aws/lambda/${prenoteApiPhysicalName}`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      this.prenoteApi = new lambda.Function(this, "PrenoteApi", {
        functionName: prenoteApiPhysicalName,
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "index.handler",
        memorySize: 256,
        timeout: cdk.Duration.seconds(15),
        logGroup: prenoteApiLogGroup,
        role: lambdaRole,
        environment: {
          CUEFLOW_TABLE_NAME: prenoteTableName,
        },
        code: lambda.Code.fromInline(`
const {
  DynamoDBClient,
  QueryCommand,
  PutItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
} = require("@aws-sdk/client-dynamodb");

const dynamodb = new DynamoDBClient({});
const TABLE_NAME = process.env.CUEFLOW_TABLE_NAME;
const PRENOTE_PREFIX = "PRENOTE#";

const JSON_HEADERS = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,x-cueflow-user-id",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
};

exports.handler = async (event) => {
  const method = (event.requestContext?.http?.method || event.httpMethod || "GET").toUpperCase();
  if (method === "OPTIONS") {
    return json(204, {});
  }

  let body = {};
  if (method === "POST" || method === "PUT") {
    try {
      body = parseBody(event);
    } catch {
      return json(400, { error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } });
    }
  }

  const route = routeParts(event);
  if (route.segments[0] !== "prenotes") {
    return json(404, { error: { code: "ROUTE_NOT_FOUND", message: "Unknown prenote route." } });
  }

  const userId = userIdFromEvent(event, body);
  if (!userId) {
    return json(400, { error: { code: "USER_REQUIRED", message: "x-cueflow-user-id is required." } });
  }

  try {
    if (method === "GET" && route.segments.length === 1) {
      const prenotes = await listPrenotes(userId);
      return json(200, { prenotes });
    }

    if (method === "POST" && route.segments.length === 1) {
      const prenote = await createPrenote(userId, body);
      return json(201, { prenote });
    }

    if (route.segments.length === 2) {
      const noteId = decodeURIComponent(route.segments[1]);
      if (method === "PUT") {
        const prenote = await updatePrenote(userId, noteId, body);
        return json(200, { prenote });
      }
      if (method === "DELETE") {
        await deletePrenote(userId, noteId);
        return json(204, {});
      }
    }

    return json(404, { error: { code: "ROUTE_NOT_FOUND", message: "Unknown prenote route." } });
  } catch (error) {
    if (error?.name === "ConditionalCheckFailedException") {
      return json(404, { error: { code: "PRENOTE_NOT_FOUND", message: "Prepared note was not found." } });
    }
    if (error instanceof InputError) {
      return json(400, { error: { code: error.code, message: error.message } });
    }
    console.error(JSON.stringify({
      eventName: "cueflow.prenote_api_failed",
      method,
      message: error instanceof Error ? error.message : String(error),
    }));
    return json(500, { error: { code: "PRENOTE_API_FAILED", message: "Prepared note request failed." } });
  }
};

class InputError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function routeParts(event) {
  const path = event.rawPath || event.path || event.requestContext?.http?.path || "/";
  return {
    path,
    segments: path.replace(/^\\/+|\\/+$/g, "").split("/").filter(Boolean),
  };
}

function parseBody(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "{}";
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Body must be an object.");
  }
  return parsed;
}

function headerValue(event, name) {
  const headers = event.headers || {};
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) {
      return headers[key];
    }
  }
  return undefined;
}

function userIdFromEvent(event, body) {
  const raw = headerValue(event, "x-cueflow-user-id") || event.queryStringParameters?.userId || body?.userId || "";
  const userId = String(raw).trim().toLowerCase();
  if (!userId || userId.includes("#") || userId.length > 160) {
    return "";
  }
  return userId;
}

function userPk(userId) {
  return "USER#" + userId;
}

function noteSk(noteId) {
  return PRENOTE_PREFIX + noteId;
}

function cleanText(value, max) {
  return String(value || "").replace(/\\r\\n/g, "\\n").replace(/\\n{4,}/g, "\\n\\n\\n").trim().slice(0, max);
}

function titleFromText(text) {
  return text.split(/\\n/).find(Boolean)?.slice(0, 80) || "Prepared Note";
}

function createInput(body) {
  const textInput = cleanText(body?.text, 12000);
  const titleInput = cleanText(body?.title, 160).replace(/\\s+/g, " ");
  if (!textInput && !titleInput) {
    throw new InputError("PRENOTE_EMPTY", "Title or context is required.");
  }
  const title = titleInput || titleFromText(textInput);
  return {
    title,
    text: textInput || title,
    selected: typeof body?.selected === "boolean" ? body.selected : true,
  };
}

function updateInput(body) {
  const hasTitle = Object.prototype.hasOwnProperty.call(body, "title");
  const hasText = Object.prototype.hasOwnProperty.call(body, "text");
  const hasSelected = Object.prototype.hasOwnProperty.call(body, "selected");
  if (!hasTitle && !hasText && !hasSelected) {
    throw new InputError("PRENOTE_PATCH_EMPTY", "Nothing to update.");
  }

  const patch = {};
  if (hasTitle) {
    patch.title = cleanText(body.title, 160).replace(/\\s+/g, " ");
  }
  if (hasText) {
    patch.text = cleanText(body.text, 12000);
  }
  if (hasTitle && hasText && !patch.title && !patch.text) {
    throw new InputError("PRENOTE_EMPTY", "Title or context is required.");
  }
  if (hasTitle && !patch.title && patch.text) {
    patch.title = titleFromText(patch.text);
  }
  if (hasText && !patch.text && patch.title) {
    patch.text = patch.title;
  }
  if (hasSelected) {
    if (typeof body.selected !== "boolean") {
      throw new InputError("PRENOTE_SELECTED_INVALID", "selected must be a boolean.");
    }
    patch.selected = body.selected;
  }
  return patch;
}

async function listPrenotes(userId) {
  const response = await dynamodb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
    ExpressionAttributeValues: {
      ":pk": { S: userPk(userId) },
      ":prefix": { S: PRENOTE_PREFIX },
    },
  }));

  return (response.Items || [])
    .map(itemToPrenote)
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
}

async function createPrenote(userId, body) {
  const input = createInput(body);
  const now = new Date().toISOString();
  const noteId = "pn-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  const item = {
    PK: { S: userPk(userId) },
    SK: { S: noteSk(noteId) },
    GSI1PK: { S: userPk(userId) },
    GSI1SK: { S: "PRENOTE#" + now + "#" + noteId },
    entityType: { S: "PRENOTE" },
    userId: { S: userId },
    noteId: { S: noteId },
    title: { S: input.title },
    text: { S: input.text },
    selected: { BOOL: input.selected },
    createdAt: { S: now },
    updatedAt: { S: now },
  };
  await dynamodb.send(new PutItemCommand({ TableName: TABLE_NAME, Item: item }));
  return itemToPrenote(item);
}

async function updatePrenote(userId, noteId, body) {
  requireNoteId(noteId);
  const patch = updateInput(body);
  const now = new Date().toISOString();
  const names = { "#updatedAt": "updatedAt", "#gsi1sk": "GSI1SK" };
  const values = {
    ":updatedAt": { S: now },
    ":gsi1sk": { S: "PRENOTE#" + now + "#" + noteId },
  };
  const updates = ["#updatedAt = :updatedAt", "#gsi1sk = :gsi1sk"];

  if (Object.prototype.hasOwnProperty.call(patch, "title")) {
    names["#title"] = "title";
    values[":title"] = { S: patch.title };
    updates.push("#title = :title");
  }
  if (Object.prototype.hasOwnProperty.call(patch, "text")) {
    names["#text"] = "text";
    values[":text"] = { S: patch.text };
    updates.push("#text = :text");
  }
  if (Object.prototype.hasOwnProperty.call(patch, "selected")) {
    names["#selected"] = "selected";
    values[":selected"] = { BOOL: patch.selected };
    updates.push("#selected = :selected");
  }

  const response = await dynamodb.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: { S: userPk(userId) },
      SK: { S: noteSk(noteId) },
    },
    ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
    UpdateExpression: "SET " + updates.join(", "),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ReturnValues: "ALL_NEW",
  }));
  return itemToPrenote(response.Attributes);
}

async function deletePrenote(userId, noteId) {
  requireNoteId(noteId);
  await dynamodb.send(new DeleteItemCommand({
    TableName: TABLE_NAME,
    Key: {
      PK: { S: userPk(userId) },
      SK: { S: noteSk(noteId) },
    },
  }));
}

function requireNoteId(noteId) {
  if (!noteId || noteId.includes("#") || noteId.length > 120) {
    throw new InputError("PRENOTE_ID_INVALID", "Prepared note id is invalid.");
  }
}

function itemToPrenote(item) {
  return {
    id: item.noteId?.S || String(item.SK?.S || "").replace(PRENOTE_PREFIX, ""),
    title: item.title?.S || "Prepared Note",
    text: item.text?.S || "",
    selected: Boolean(item.selected?.BOOL),
    createdAt: item.createdAt?.S || "",
    updatedAt: item.updatedAt?.S || item.createdAt?.S || "",
  };
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: statusCode === 204 ? "" : JSON.stringify(payload),
  };
}
`),
      });

      if (!lambdaRole) {
        this.frontendBucket.grantRead(this.assetServer);
        const openAiSecret = aiProxyOpenAiSecretId.startsWith("arn:")
          ? secretsmanager.Secret.fromSecretCompleteArn(this, "OpenAiSecret", aiProxyOpenAiSecretId)
          : secretsmanager.Secret.fromSecretNameV2(this, "OpenAiSecret", aiProxyOpenAiSecretId);
        openAiSecret.grantRead(this.aiProxy);
        this.prenoteApi.addToRolePolicy(new iam.PolicyStatement({
          actions: [
            "dynamodb:Query",
            "dynamodb:PutItem",
            "dynamodb:UpdateItem",
            "dynamodb:DeleteItem",
          ],
          resources: [
            cdk.Stack.of(this).formatArn({
              service: "dynamodb",
              resource: "table",
              resourceName: prenoteTableName,
            }),
          ],
        }));
      }

      const frontendIntegration = new integrations.HttpLambdaIntegration("FrontendAssetIntegration", this.assetServer);
      const aiProxyIntegration = new integrations.HttpLambdaIntegration("AiProxyIntegration", this.aiProxy);
      const prenoteApiIntegration = new integrations.HttpLambdaIntegration("PrenoteApiIntegration", this.prenoteApi);
      this.httpsApi = new apigwv2.HttpApi(this, "FrontendHttpsApi", {
        apiName: `cueflow-frontend-${props.stage}`,
      });
      this.httpsApi.addRoutes({ path: "/", methods: [apigwv2.HttpMethod.GET], integration: frontendIntegration });
      this.httpsApi.addRoutes({ path: "/{proxy+}", methods: [apigwv2.HttpMethod.GET], integration: frontendIntegration });
      this.httpsApi.addRoutes({ path: "/ai/cue", methods: [apigwv2.HttpMethod.POST], integration: aiProxyIntegration });
      this.httpsApi.addRoutes({ path: "/ai/summary", methods: [apigwv2.HttpMethod.POST], integration: aiProxyIntegration });
      this.httpsApi.addRoutes({ path: "/prenotes", methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST, apigwv2.HttpMethod.OPTIONS], integration: prenoteApiIntegration });
      this.httpsApi.addRoutes({ path: "/prenotes/{noteId}", methods: [apigwv2.HttpMethod.PUT, apigwv2.HttpMethod.DELETE, apigwv2.HttpMethod.OPTIONS], integration: prenoteApiIntegration });
    }

    new cdk.CfnOutput(this, "FrontendBucketName", { value: this.frontendBucket.bucketName });
    if (useS3Website) {
      new cdk.CfnOutput(this, "FrontendWebsiteUrl", { value: this.frontendBucket.bucketWebsiteUrl });
    } else if (useApiStatic && this.httpsApi) {
      new cdk.CfnOutput(this, "FrontendHttpsUrl", { value: this.httpsApi.apiEndpoint });
    } else if (this.distribution) {
      new cdk.CfnOutput(this, "FrontendDistributionDomain", { value: this.distribution.distributionDomainName });
    }
  }
}

type ApiStackProps = CueFlowStackProps & {
  table: dynamodb.Table;
  dataBucket: s3.Bucket;
  cueQueue: sqs.Queue;
  summaryQueue: sqs.Queue;
  lambdaRoleArn?: string;
};

class ApiStack extends cdk.Stack {
  readonly restApi: apigwv2.HttpApi;
  readonly webSocketApi: apigwv2.WebSocketApi;
  readonly webSocketStage: apigwv2.WebSocketStage;
  readonly restHandler: lambda.Function;
  readonly webSocketHandler: lambda.Function;
  readonly cueWorker: lambda.Function;
  readonly summaryWorker: lambda.Function;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const baseEnvironment = {
      CUEFLOW_STAGE: props.stage,
      CUEFLOW_TABLE_NAME: props.table.tableName,
      CUEFLOW_DATA_BUCKET_NAME: props.dataBucket.bucketName,
      CUEFLOW_CUE_QUEUE_URL: props.cueQueue.queueUrl,
      CUEFLOW_SUMMARY_QUEUE_URL: props.summaryQueue.queueUrl,
      CUEFLOW_AI_PROVIDER: process.env.CUEFLOW_AI_PROVIDER ?? "mock",
      OPENAI_MODEL: process.env.OPENAI_MODEL ?? "gpt-5.4-mini",
      NODE_OPTIONS: "--enable-source-maps",
    };

    const lambdaRole = props.lambdaRoleArn
      ? iam.Role.fromRoleArn(this, "LearnerLabLambdaRole", props.lambdaRoleArn, { mutable: false })
      : undefined;

    this.restHandler = this.lambdaFunction("RestHandler", "rest-handler", baseEnvironment, lambdaRole);
    this.webSocketHandler = this.lambdaFunction("WebSocketHandler", "websocket-handler", baseEnvironment, lambdaRole);
    this.cueWorker = this.lambdaFunction("CueWorker", "cue-worker", baseEnvironment, lambdaRole);
    this.summaryWorker = this.lambdaFunction("SummaryWorker", "summary-worker", baseEnvironment, lambdaRole);

    if (!lambdaRole) {
      props.table.grantReadWriteData(this.restHandler);
      props.table.grantReadWriteData(this.webSocketHandler);
      props.table.grantReadWriteData(this.cueWorker);
      props.table.grantReadWriteData(this.summaryWorker);
      props.dataBucket.grantReadWrite(this.restHandler);
      props.dataBucket.grantReadWrite(this.webSocketHandler);
      props.dataBucket.grantReadWrite(this.cueWorker);
      props.dataBucket.grantReadWrite(this.summaryWorker);
      props.cueQueue.grantSendMessages(this.webSocketHandler);
      props.cueQueue.grantConsumeMessages(this.cueWorker);
      props.summaryQueue.grantSendMessages(this.restHandler);
      props.summaryQueue.grantConsumeMessages(this.summaryWorker);
    }

    this.restApi = new apigwv2.HttpApi(this, "RestApi", {
      apiName: `cueflow-rest-${props.stage}`,
      corsPreflight: {
        allowHeaders: ["content-type", "authorization"],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS],
        allowOrigins: ["*"],
        maxAge: cdk.Duration.hours(1),
      },
    });

    const restIntegration = new integrations.HttpLambdaIntegration("RestIntegration", this.restHandler);
    this.restApi.addRoutes({ path: "/conversations", methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST], integration: restIntegration });
    this.restApi.addRoutes({ path: "/conversations/{conversationId}", methods: [apigwv2.HttpMethod.GET], integration: restIntegration });
    this.restApi.addRoutes({ path: "/conversations/{conversationId}/cues", methods: [apigwv2.HttpMethod.GET], integration: restIntegration });
    this.restApi.addRoutes({ path: "/conversations/{conversationId}/end", methods: [apigwv2.HttpMethod.POST], integration: restIntegration });
    this.restApi.addRoutes({ path: "/conversations/{conversationId}/summary", methods: [apigwv2.HttpMethod.GET], integration: restIntegration });
    this.restApi.addRoutes({ path: "/demo/replay", methods: [apigwv2.HttpMethod.POST], integration: restIntegration });

    this.webSocketApi = new apigwv2.WebSocketApi(this, "WebSocketApi", {
      apiName: `cueflow-websocket-${props.stage}`,
      connectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration("ConnectIntegration", this.webSocketHandler),
      },
      disconnectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration("DisconnectIntegration", this.webSocketHandler),
      },
      defaultRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration("DefaultIntegration", this.webSocketHandler),
      },
    });

    const webSocketIntegration = new integrations.WebSocketLambdaIntegration("MessageIntegration", this.webSocketHandler);
    for (const routeKey of ["sendTranscript", "ping", "clientAckCue"]) {
      this.webSocketApi.addRoute(routeKey, { integration: webSocketIntegration });
    }

    this.webSocketStage = new apigwv2.WebSocketStage(this, "WebSocketStage", {
      webSocketApi: this.webSocketApi,
      stageName: props.stage,
      autoDeploy: true,
    });

    const manageConnectionsPolicy = new iam.PolicyStatement({
      actions: ["execute-api:ManageConnections"],
      resources: [
        cdk.Stack.of(this).formatArn({
          service: "execute-api",
          resource: this.webSocketApi.apiId,
          resourceName: `${props.stage}/POST/@connections/*`,
        }),
      ],
    });
    if (!lambdaRole) {
      this.cueWorker.addToRolePolicy(manageConnectionsPolicy);
      this.summaryWorker.addToRolePolicy(manageConnectionsPolicy);
    }

    new cdk.CfnOutput(this, "RestApiUrl", { value: this.restApi.apiEndpoint });
    new cdk.CfnOutput(this, "WebSocketApiUrl", { value: this.webSocketStage.url });
  }

  private lambdaFunction(
    id: string,
    functionName: string,
    environment: Record<string, string>,
    role?: iam.IRole,
  ): lambda.Function {
    const physicalName = `cueflow-${functionName}-${stage}`;
    const logGroup = new logs.LogGroup(this, `${id}LogGroup`, {
      logGroupName: `/aws/lambda/${physicalName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    return new lambda.Function(this, id, {
      functionName: physicalName,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      memorySize: 256,
      timeout: cdk.Duration.seconds(20),
      logGroup,
      environment,
      role,
      code: lambda.Code.fromInline(`
exports.handler = async (event, context) => {
  console.log(JSON.stringify({
    eventName: "${functionName}.invoked",
    requestId: context.awsRequestId,
    status: "ok"
  }));
  return {
    statusCode: 200,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
    body: JSON.stringify({ service: "${functionName}", status: "configured" })
  };
};
`),
    });
  }
}

type MonitoringStackProps = CueFlowStackProps & {
  apiStack: ApiStack;
  queueStack: QueueStack;
};

class MonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const dashboard = new cloudwatch.Dashboard(this, "CueFlowDashboard", {
      dashboardName: `CueFlow-${props.stage}`,
    });

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "Lambda Errors",
        left: [
          props.apiStack.restHandler.metricErrors(),
          props.apiStack.webSocketHandler.metricErrors(),
          props.apiStack.cueWorker.metricErrors(),
          props.apiStack.summaryWorker.metricErrors(),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: "Queue Depth",
        left: [
          props.queueStack.cueQueue.metricApproximateNumberOfMessagesVisible(),
          props.queueStack.summaryQueue.metricApproximateNumberOfMessagesVisible(),
        ],
      }),
      new cloudwatch.GraphWidget({
        title: "DLQ Messages",
        left: [
          props.queueStack.cueDlq.metricApproximateNumberOfMessagesVisible(),
          props.queueStack.summaryDlq.metricApproximateNumberOfMessagesVisible(),
        ],
      }),
    );

    for (const fn of [props.apiStack.restHandler, props.apiStack.webSocketHandler, props.apiStack.cueWorker, props.apiStack.summaryWorker]) {
      new cloudwatch.Alarm(this, `${fn.node.id}ErrorAlarm`, {
        metric: fn.metricErrors({ period: cdk.Duration.minutes(5) }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      });
    }

    for (const queue of [props.queueStack.cueQueue, props.queueStack.summaryQueue]) {
      new cloudwatch.Alarm(this, `${queue.node.id}DepthAlarm`, {
        metric: queue.metricApproximateNumberOfMessagesVisible({ period: cdk.Duration.minutes(5) }),
        threshold: 50,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      });
    }

    for (const queue of [props.queueStack.cueDlq, props.queueStack.summaryDlq]) {
      new cloudwatch.Alarm(this, `${queue.node.id}MessageAlarm`, {
        metric: queue.metricApproximateNumberOfMessagesVisible({ period: cdk.Duration.minutes(5) }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      });
    }
  }
}

const stackProps: CueFlowStackProps = {
  env,
  stage,
  autoDeleteObjects: !bootstrapless,
  synthesizer: bootstrapless ? new cdk.BootstraplessSynthesizer() : undefined,
};
const storage = new StorageStack(app, `CueFlowStorage-${stage}`, stackProps);
const queues = new QueueStack(app, `CueFlowQueues-${stage}`, stackProps);
if (!skipFrontend) {
  new FrontendHostingStack(app, `CueFlowFrontend-${stage}`, {
    ...stackProps,
    mode: frontendMode,
    lambdaRoleArn: labRoleArn,
    openAiSecretId,
    tableName: `CueFlowTable-${stage}`,
  });
}
const api = new ApiStack(app, `CueFlowApi-${stage}`, {
  ...stackProps,
  table: storage.table,
  dataBucket: storage.dataBucket,
  cueQueue: queues.cueQueue,
  summaryQueue: queues.summaryQueue,
  lambdaRoleArn: labRoleArn,
});
new MonitoringStack(app, `CueFlowMonitoring-${stage}`, {
  ...stackProps,
  apiStack: api,
  queueStack: queues,
});
