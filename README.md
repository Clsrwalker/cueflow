# CueFlow

CueFlow is a mobile-first cloud-native conversation intelligence MVP for the CSCI 5411 term project.

A user opens a session list, starts a live conversation, speaks through the phone/browser microphone, receives lightweight AI cue cards, ends the session, and views a structured conversation summary and conversation history. The UI keeps CueFlow independent from external hardware; deployed microphone transcription requires HTTPS or localhost.

## Architecture Summary

- Presentation tier: React + Vite mobile-first web client, hosted on S3 and CloudFront in AWS by default, with an API Gateway HTTPS static frontend fallback for restricted Learner Lab accounts.
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

1. Open the Sessions home page.
2. Review My Records and Prepared Notes.
3. Click Start.
4. Allow microphone access and speak.
5. Watch Transcript update inside the live Conversation page.
6. Use Pause/Resume or End from the bottom action bar.
7. Review the saved summary, transcript, and AI cues from the session record.

The frontend uses browser speech recognition on HTTPS or localhost. The UI still works without cloud deployment, while backend provider abstractions are available for deployed REST/WebSocket runtimes.

## Environment Variables

Local demo:
- No required environment variables.

Frontend optional:
- `VITE_CUEFLOW_API_BASE`: REST API base URL for a future deployed backend integration.
- `VITE_CUEFLOW_WS_URL`: WebSocket URL for a future deployed backend integration.

Backend and infrastructure:
- `CUEFLOW_STAGE`: deployment stage, for example `dev`.
- `CUEFLOW_AI_PROVIDER`: `mock` or `openai`. If omitted, CueFlow uses OpenAI when `OPENAI_API_KEY` is present and mock AI otherwise.
- `OPENAI_API_KEY`: OpenAI API key for the optional OpenAI provider. Never commit this value.
- `OPENAI_MODEL`: OpenAI model for cue and summary generation. Defaults to `gpt-5.4-mini`.
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

The current frontend runs in-browser with live microphone transcription and local cue/summary generation. The backend provider is ready for REST/WebSocket worker runtimes that instantiate `createAiProviderFromEnv()`.

## Deployment

Synthesize infrastructure:

```bash
npm run synth
```

Deploy when AWS credentials are configured:

```bash
cd infra
npm run build
cdk deploy --all --context stage=dev
```

AWS Academy Learner Lab may block CDK bootstrap IAM role creation. If the lab provides an existing `LabRole`, use:

```bash
cd infra
npm run build
cdk deploy --all --app "node dist/index.js" --context stage=dev --context bootstrapless=true --context labRoleArn=arn:aws:iam::<account-id>:role/LabRole --require-approval never
```

If the lab also blocks CloudFront, keep the frontend hosting stack for the architecture submission but skip that stack for the lab account:

```bash
cd infra
npm run build
cdk deploy --all --app "node dist/index.js" --context stage=dev --context bootstrapless=true --context skipFrontend=true --context labRoleArn=arn:aws:iam::<account-id>:role/LabRole --role-arn arn:aws:iam::<account-id>:role/LabRole --require-approval never
```

For a Learner Lab frontend without CloudFront that still supports browser microphone permission, deploy the API Gateway HTTPS static frontend mode:

```bash
cd infra
npm run build
cdk deploy CueFlowFrontend-dev --app "node dist/index.js" --context stage=dev --context bootstrapless=true --context frontendMode=api-static --context labRoleArn=arn:aws:iam::<account-id>:role/LabRole --role-arn arn:aws:iam::<account-id>:role/LabRole --require-approval never
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

- Lambda CDK resources currently use deployable placeholder handler code. The backend logic is implemented and tested, but a production deployment should add a bundling step that packages compiled backend handlers into Lambda assets.
- Local UI uses browser speech recognition on localhost. It is ready for demo and can later be wired to deployed REST and WebSocket URLs.
- Authentication is intentionally minimal for the MVP. A production version should add Cognito or a JWT authorizer and restrict CORS origins.
- AWS integration tests are mocked locally to keep the course demo runnable without a permanent AWS environment.

## Future Work

- Add a Lambda bundling pipeline for compiled backend handlers.
- Add deployed runtime wiring that packages backend handlers and uses the OpenAI provider in Lambda.
- Add user authentication and per-user authorization.
- Add deployed frontend environment configuration for REST and WebSocket URLs.
- Add cloud integration tests for a stable AWS account.

## AI-Generated Code Disclosure

This project was developed with AI-assisted coding support. The implementation is intended to be original to CueFlow and reviewed before submission.
