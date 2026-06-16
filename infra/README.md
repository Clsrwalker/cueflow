# CueFlow Infrastructure

AWS CDK TypeScript app for the CueFlow course MVP.

Stacks:

- `CueFlowStorage-{stage}`: DynamoDB single-table metadata and encrypted S3 data bucket.
- `CueFlowQueues-{stage}`: SQS cue and summary queues with DLQs.
- `CueFlowApi-{stage}`: HTTP API, WebSocket API, and Lambda function definitions.
- `CueFlowFrontend-{stage}`: S3 frontend bucket and CloudFront distribution.
- `CueFlowMonitoring-{stage}`: CloudWatch dashboard and alarms.

Commands:

```bash
npm run build --workspace @cueflow/infra
npm run synth --workspace @cueflow/infra
```

Use `cdk deploy --all --context stage=dev` from `infra/` when AWS Learner Lab credentials are configured locally.
