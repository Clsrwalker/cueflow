# CueFlow Demo Script

Target length: 10 minutes.

## 0:00 - 1:00 Project Overview

Open the README and explain CueFlow as a mobile-first cloud-native conversation intelligence MVP. Point out the tiers: React client, REST API, WebSocket API, Lambda workers, SQS, DynamoDB, S3, CloudWatch, CDK, and CI.

## 1:00 - 3:00 Cloud App Demo

Open the deployed HTTPS frontend URL. If running locally, provide:

```bash
VITE_CUEFLOW_API_BASE=<https api url>
VITE_CUEFLOW_WS_URL=<wss api url>
npm run dev --workspace @cueflow/frontend
```

Click:
1. Review the Sessions home page, My Records list, and Prepared Notes dock.
2. Add or select a Prepared Note.
3. Start a new session.
4. Allow microphone access and speak a question such as "How should we explain the CueFlow cloud architecture risk?"
5. Watch Transcript update while WebSocket sends final chunks to the backend.
6. Watch AI cues appear from the SQS worker/OpenAI path.
7. End the conversation.
8. Review the persisted summary, transcript, and cue history from My Records.

## 3:00 - 5:00 Backend Design

Show backend tests and code structure:
- REST conversation service.
- WebSocket transcript flow.
- Queue abstractions.
- Cue worker and summary worker.
- OpenAI provider plus deterministic mock provider for tests.

Run:

```bash
npm test
```

## 5:00 - 7:00 Infrastructure

Show `infra/src/index.ts`.

Explain:
- DynamoDB single-table metadata.
- S3 transcript and summary object storage.
- SQS queues and DLQs.
- API Gateway HTTP and WebSocket APIs.
- Lambda handlers and workers.
- Secrets Manager OpenAI key.
- CloudFront/S3 frontend hosting.
- CloudWatch dashboard and alarms.

Run:

```bash
npm run synth
```

## 7:00 - 8:30 Trade-offs

Open `docs/tradeoffs.md` and discuss:
- WebSocket vs REST polling.
- Synchronous AI vs SQS worker.
- Lambda vs container service.
- DynamoDB vs relational database.
- OpenAI provider vs deterministic mock tests.

## 8:30 - 10:00 Well-Architected Summary

Open `docs/well-architected.md` and map CueFlow to the six pillars. Close by showing GitHub Actions workflow and explaining that deploy is optional unless AWS credentials are configured.
