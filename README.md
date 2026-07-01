# CueFlow

CueFlow is a mobile-first cloud-native conversation intelligence MVP for the CSCI 5411 term project.

A user opens a session list, starts a live conversation, speaks through the phone/browser microphone, receives lightweight AI cue cards, ends the session, and views a structured conversation summary and conversation history. The UI keeps CueFlow independent from external hardware; deployed microphone transcription requires HTTPS or localhost.

## Architecture Summary

- Presentation tier: React + Vite mobile-first responsive web client, hosted on S3 and CloudFront in AWS by default, with an API Gateway HTTPS static frontend fallback for restricted Learner Lab accounts.
- API and edge tier: API Gateway HTTP API for REST and API Gateway WebSocket API for real-time traffic.
- Application tier: Lambda REST/WebSocket handlers, SQS-backed cue and summary workers, and AI provider abstraction.
- Data tier: DynamoDB single-table metadata plus S3 transcript and summary objects.
- Observability and DevOps tier: CloudWatch logs, metrics, dashboard, alarms, AWS CDK, and GitHub Actions.

See [docs/architecture.md](docs/architecture.md) for the full design.

## Repository Layout

```text
cueflow/
  frontend/   React/Vite mobile UI
  backend/    REST, WebSocket, queue, worker, storage, and AI logic
  shared/     Shared domain types, key builders, and validation helpers
  infra/      AWS CDK infrastructure code
  docs/       Architecture, API, NFR, trade-off, Well-Architected, and demo docs
```

## Local Setup

```bash
npm install
npm test
npm run typecheck
npm run build
npm run synth
```

Run the local UI:

```bash
npm run dev --workspace @cueflow/frontend
```

Open `http://localhost:5174`.

## Demo Steps

1. Create an account or sign in from the CueFlow login page.
2. Open the user sidebar from the Sessions header to review or edit profile details.
3. Review My Records and select any Prepared Notes that should be used as prompt context.
4. Use the Prepared Notes manager to add, edit, or delete prenotes.
5. Click Start.
6. Allow microphone access and speak.
7. Watch Transcript update inside the live Conversation page while final chunks are sent to the WebSocket backend.
8. Use Pause/Resume or End from the bottom action bar.
9. Review the saved summary, transcript, and AI cues from the persisted session record.

Selected Prepared Notes are passed as prompt context through the WebSocket cue path and REST summary path. Cue and summary workers call the configured OpenAI provider and persist results before the history view reloads them.

The frontend uses browser speech recognition on HTTPS or localhost. In the deployed demo, browser speech recognition turns microphone audio into text, then CueFlow sends final transcript chunks through API Gateway WebSocket into Lambda, SQS, DynamoDB, S3, and OpenAI.

## Environment Variables

Local UI development:
- `VITE_CUEFLOW_API_BASE`: REST API base URL. Leave empty only when serving the frontend from the same deployed API Gateway HTTP API.
- `VITE_CUEFLOW_WS_URL`: deployed API Gateway WebSocket URL.

Deployed frontend runtime:
- `/runtime-config.json` is served by the frontend asset Lambda and provides the deployed WebSocket URL to the browser.

Backend and infrastructure:
- `CUEFLOW_STAGE`: deployment stage, for example `dev`.
- `CUEFLOW_AI_PROVIDER`: `openai` for deployed AI-backed workers, or `mock` for deterministic local tests.
- `OPENAI_SECRET_ID`: Secrets Manager secret id or ARN that stores the OpenAI API key.
- `OPENAI_API_KEY`: local-only OpenAI API key fallback. Never commit this value.
- `OPENAI_MODEL`: OpenAI model for live cue generation. Defaults to `gpt-5.4-nano`.
- `OPENAI_SUMMARY_MODEL`: OpenAI model for post-session summaries. Defaults to `gpt-5.4-mini`.
- `CUEFLOW_TABLE_NAME`: DynamoDB table name.
- `CUEFLOW_DATA_BUCKET_NAME`: S3 data bucket name.
- `CUEFLOW_CUE_QUEUE_URL`: SQS cue queue URL.
- `CUEFLOW_SUMMARY_QUEUE_URL`: SQS summary queue URL.

GitHub Actions optional deploy:
- `AWS_ROLE_ARN`: GitHub secret for OIDC role assumption.
- `AWS_REGION`: GitHub variable, defaults to `us-east-1`.

Do not commit AWS credentials. Use local AWS CLI profile configuration for manual deploys.

To use OpenAI locally:

```bash
copy .env.example .env
# edit .env and set OPENAI_API_KEY
```

For AWS deployments, store the key in Secrets Manager instead of bundling it into frontend or Lambda code.

## Deployment

Synthesize infrastructure:

```bash
npm run synth
```

Deploy when AWS credentials are configured:

```bash
cd infra
npm run synth
cdk deploy --all --app "node dist/index.js" --context stage=dev
```

AWS Academy Learner Lab may block CDK bootstrap IAM role creation. If the lab provides an existing `LabRole`, use:

```bash
cd infra
npm run synth
cdk deploy --all --app "node dist/index.js" --context stage=dev --context labRoleArn=arn:aws:iam::<account-id>:role/LabRole --role-arn arn:aws:iam::<account-id>:role/LabRole --require-approval never
```

If the lab cannot use CDK asset publishing for Lambda bundles, upload `backend/dist/lambda` as a zip to an S3 bucket and pass it through context:

```bash
npm run build:lambdas --workspace @cueflow/backend
# zip backend/dist/lambda/* and upload it to S3, then:
cd infra
cdk deploy CueFlowApi-dev --app "node dist/index.js" --context stage=dev --context bootstrapless=true --context labRoleArn=arn:aws:iam::<account-id>:role/LabRole --context lambdaAssetBucket=<bucket> --context lambdaAssetKey=<key.zip> --role-arn arn:aws:iam::<account-id>:role/LabRole --require-approval never
```

For a Learner Lab frontend without CloudFront that still supports browser microphone permission, deploy the API Gateway HTTPS static frontend mode:

```bash
cd infra
cdk deploy CueFlowFrontend-dev --app "node dist/index.js" --context stage=dev --context frontendMode=api-static --context disableAutoDeleteObjects=true --context labRoleArn=arn:aws:iam::<account-id>:role/LabRole --role-arn arn:aws:iam::<account-id>:role/LabRole --require-approval never
aws s3 sync ../frontend/dist s3://<frontend-bucket-name> --delete
```

The CDK app defines:
- S3 frontend bucket and CloudFront distribution, with an API Gateway HTTPS frontend fallback for restricted lab accounts.
- S3 data bucket.
- API Gateway HTTP API.
- API Gateway WebSocket API.
- DynamoDB table.
- SQS cue and summary queues with DLQs.
- Lambda handlers and workers.
- CloudWatch dashboard and alarms.

## API Contract Summary

REST:
- `POST /conversations`
- `GET /conversations`
- `GET /conversations/{conversationId}`
- `GET /conversations/{conversationId}/transcript`
- `GET /conversations/{conversationId}/cues`
- `POST /conversations/{conversationId}/end`
- `GET /conversations/{conversationId}/summary`
- `POST /demo/replay`

WebSocket:
- `$connect`
- `$disconnect`
- `sendTranscript`
- `ping`
- `clientAckCue`

See [docs/api-contract.md](docs/api-contract.md).

## Testing

```bash
npm test
```

Coverage includes shared validation, DynamoDB/S3 key builders, cue trigger policy, mock AI provider, REST handler, WebSocket handler, queue abstractions, cue worker, and summary worker.

## CI/CD

GitHub Actions runs:
1. `npm ci`
2. `npm test`
3. `npm run typecheck`
4. `npm run build`
5. `npm run synth`

On `main`, deploy runs only when `AWS_ROLE_ARN` is configured.

## Known Limitations

- Local Vite development requires `VITE_CUEFLOW_API_BASE` and `VITE_CUEFLOW_WS_URL` if you want to run against the deployed backend from localhost.
- Browser speech recognition is the ASR layer. The real-time cloud pipeline begins at final transcript text chunks, not raw audio streaming.
- Authentication is intentionally minimal for the course MVP. The backend uses `x-cueflow-user-id` for per-user data isolation. A production version should add Cognito or a JWT authorizer and restrict CORS origins.
- My Records deletion is currently a client-side view action; persisted conversation deletion is not part of the MVP API.
- AWS integration tests are mocked locally to keep the course demo runnable without a permanent AWS environment.

## Future Work

- Add user authentication and per-user authorization.
- Add a persisted delete/archive API for conversation records.
- Add cloud integration tests for a stable AWS account.

## AI-Generated Code Disclosure

This project was developed with AI-assisted coding support. The implementation is intended to be original to CueFlow and reviewed before submission.
