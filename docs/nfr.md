# Non-Functional Requirements

| Target | Goal | Architecture Impact |
| --- | --- | --- |
| Transcript ingest latency | p95 under 300 ms | WebSocket handler validates, persists, evaluates trigger policy, and enqueues work without waiting for AI. |
| Cue generation latency | p95 under 4 seconds, p99 under 8 seconds | SQS worker uses a short transcript context window and a lower-cost OpenAI cue model. |
| Summary latency | p95 under 15 seconds after session end | End request enqueues summary job and returns while summary worker runs independently. |
| API availability | 99.9 percent target | API Gateway, Lambda, DynamoDB, SQS, and S3 are managed services. |
| RPO | Under 1 minute | Transcript chunks are persisted before cue generation starts. |
| RTO | Under 10 minutes | CDK and GitHub Actions can rebuild the environment from source. |
| Peak demo load | 100 concurrent conversations | Serverless compute and queue buffering smooth burst traffic. |
| Retention | 30 days for demo transcript data | S3 lifecycle rules expire raw and summary objects. |
| Cost | Course-demo budget | Serverless pay-per-use, trigger-based AI calls, and short log retention. |
| Maintainability | Main branch validates automatically | CI runs install, tests, typecheck, build, and CDK synth. |

## Testing Scope

Local unit tests cover shared validation, key builders, trigger policy, mock AI provider, REST handler, WebSocket handler, queue abstractions, and workers. AWS integration tests are documented as mocked because the course demo must run without a permanent cloud environment.
