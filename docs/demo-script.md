# CueFlow Demo Script

Target length: 10 minutes.

## 0:00 - 1:00 Project Overview

Open the README and explain CueFlow as a mobile-first cloud-native conversation intelligence MVP. Point out the tiers: React client, REST API, WebSocket API, Lambda workers, SQS, DynamoDB, S3, CloudWatch, CDK, and CI.

## 1:00 - 3:00 Local App Demo

Run:

```bash
npm install
npm run dev --workspace @cueflow/frontend
```

Open `http://localhost:5174`.

Click:
1. Review the Sessions home page, My Records list, and Prepared Notes dock.
2. Start a new session.
3. Allow microphone access and speak.
4. Open the Transcript tab and watch live speech text arrive.
5. Open the AI Summary tab and watch cue cards appear as the session develops.
6. End the conversation.
7. Review the saved summary, transcript, and cue history.

## 3:00 - 5:00 Backend Design

Show backend tests and code structure:
- REST conversation service.
- WebSocket transcript flow.
- Queue abstractions.
- Cue worker and summary worker.
- Mock AI provider.

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
- Mock provider vs external LLM.

## 8:30 - 10:00 Well-Architected Summary

Open `docs/well-architected.md` and map CueFlow to the six pillars. Close by showing GitHub Actions workflow and explaining that deploy is optional unless AWS credentials are configured.
