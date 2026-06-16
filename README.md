# CueFlow

CueFlow is a mobile-first cloud-native conversation intelligence MVP for the CSCI 5411 term project.

The app lets a user start a live conversation, send transcript chunks, receive lightweight AI cues, end the session, and view a structured summary and conversation history. The local demo will use deterministic mock AI so it does not require a microphone, STT provider, device integration, or external LLM key.

## Architecture Summary

CueFlow is designed as a multi-tier cloud-native system:

- Presentation tier: React + Vite mobile-first web client.
- API / edge tier: REST and WebSocket contracts for conversation lifecycle and real-time transcript traffic.
- Application tier: TypeScript serverless-style handlers, async cue and summary workers, and an AI provider abstraction.
- Data tier: DynamoDB-style metadata records and S3-style transcript / summary object storage.
- DevOps and observability tier: AWS CDK, GitHub Actions, structured logs, metrics, dashboard, and alarms.

## Repository Layout

```text
cueflow/
  frontend/   React/Vite mobile UI
  backend/    REST, WebSocket, worker, storage, and observability code
  shared/     Shared domain types, key builders, and validation helpers
  infra/      AWS CDK infrastructure code
  docs/       Architecture, API, NFR, trade-off, Well-Architected, and demo docs
```

## Local Setup

```bash
npm install
npm test
npm run build
```

Phase 1 initializes the project structure and shared domain foundation. Later phases will add the local REST/WebSocket runtime, mock async workers, full UI, CDK stacks, CI/CD, and detailed documentation.

## Environment Variables

No environment variables are required for Phase 1.

Planned local variables:

- `VITE_CUEFLOW_API_BASE`: optional frontend API base URL.
- `CUEFLOW_STAGE`: deployment stage, for example `dev` or `staging`.
- `CUEFLOW_AI_PROVIDER`: `mock` by default.

## Demo Flow

Planned MVP demo:

1. Start Conversation.
2. Replay Demo Transcript or manually send transcript chunks.
3. Watch transcript lines appear.
4. Receive deterministic AI cue cards.
5. End Conversation.
6. View Conversation Summary and Conversation History.

## Deployment Plan

AWS deployment will be defined through CDK:

- S3 and CloudFront for frontend hosting.
- API Gateway HTTP API and WebSocket API.
- Lambda handlers and workers.
- SQS queues and DLQs.
- DynamoDB table for metadata and connection state.
- S3 bucket for transcript and summary objects.
- CloudWatch dashboard, logs, metrics, and alarms.

## Known Limitations

- Phase 1 does not include a runnable backend or full frontend workflow yet.
- The AI provider is not implemented in Phase 1.
- AWS resources are not provisioned in Phase 1.

## Future Work

- Implement deterministic mock AI cue and summary generation.
- Add local REST and WebSocket-compatible runtime.
- Add CDK stacks and GitHub Actions CI/CD.
- Add CloudWatch-style structured logs and metrics.
- Add optional Bedrock/OpenAI-compatible AI provider.

## AI-Generated Code Disclosure

This project is being developed with AI-assisted coding support. All submitted application logic is intended to be original to this project and reviewed before use.

