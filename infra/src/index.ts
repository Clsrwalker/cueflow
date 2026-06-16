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
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

type CueFlowStackProps = cdk.StackProps & {
  stage: string;
  autoDeleteObjects?: boolean;
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
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: CueFlowStackProps) {
    super(scope, id, props);

    this.frontendBucket = new s3.Bucket(this, "FrontendBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: props.autoDeleteObjects ?? true,
    });

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

    new cdk.CfnOutput(this, "FrontendBucketName", { value: this.frontendBucket.bucketName });
    new cdk.CfnOutput(this, "FrontendDistributionDomain", { value: this.distribution.distributionDomainName });
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
  new FrontendHostingStack(app, `CueFlowFrontend-${stage}`, stackProps);
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
