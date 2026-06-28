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
          OPENAI_API_KEY: "",
          OPENAI_MODEL: process.env.OPENAI_MODEL ?? "gpt-5.4-nano",
          OPENAI_SUMMARY_MODEL: process.env.OPENAI_SUMMARY_MODEL ?? "gpt-5.5",
        },
        code: lambda.Code.fromInline(`
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

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

  const apiKey = process.env.OPENAI_API_KEY;
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

      if (!lambdaRole) {
        this.frontendBucket.grantRead(this.assetServer);
      }

      const frontendIntegration = new integrations.HttpLambdaIntegration("FrontendAssetIntegration", this.assetServer);
      const aiProxyIntegration = new integrations.HttpLambdaIntegration("AiProxyIntegration", this.aiProxy);
      this.httpsApi = new apigwv2.HttpApi(this, "FrontendHttpsApi", {
        apiName: `cueflow-frontend-${props.stage}`,
      });
      this.httpsApi.addRoutes({ path: "/", methods: [apigwv2.HttpMethod.GET], integration: frontendIntegration });
      this.httpsApi.addRoutes({ path: "/{proxy+}", methods: [apigwv2.HttpMethod.GET], integration: frontendIntegration });
      this.httpsApi.addRoutes({ path: "/ai/cue", methods: [apigwv2.HttpMethod.POST], integration: aiProxyIntegration });
      this.httpsApi.addRoutes({ path: "/ai/summary", methods: [apigwv2.HttpMethod.POST], integration: aiProxyIntegration });
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
