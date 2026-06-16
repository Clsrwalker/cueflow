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

Learner Lab accounts may block CDK bootstrap role creation. If your lab provides an existing `LabRole`, use the bootstrapless mode:

```bash
cdk deploy --all --app "node dist/index.js" --context stage=dev --context bootstrapless=true --context labRoleArn=arn:aws:iam::<account-id>:role/LabRole --require-approval never
```

Some lab policies also block CloudFront creation. In that case, keep the CloudFront stack defined in code but skip it for the lab deployment:

```bash
cdk deploy --all --app "node dist/index.js" --context stage=dev --context bootstrapless=true --context skipFrontend=true --context labRoleArn=arn:aws:iam::<account-id>:role/LabRole --role-arn arn:aws:iam::<account-id>:role/LabRole --require-approval never
```
