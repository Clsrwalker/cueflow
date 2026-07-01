# Architecture Trade-offs

## WebSocket vs REST Polling

Decision: use WebSocket for real-time cue delivery and REST for history, cues, and summaries.

Why: cue cards are time-sensitive and benefit from server push. REST remains simpler and cache-friendly for non-real-time reads.

Risk: WebSocket adds connection state. CueFlow stores connection records in DynamoDB and removes stale records when push fails.

## Synchronous AI Call vs SQS Worker

Decision: use SQS async workers for cue and summary generation.

Why: transcript ingest should not wait on model latency. Queue retries also protect against transient AI failures.

Risk: the UI must handle pending states. CueFlow shows queued worker state and fetches saved cues through REST if reconnect happens.

## Lambda vs ECS Fargate

Decision: use Lambda.

Why: the workload is event-driven, bursty, and short-running. Lambda lowers operational overhead for a course project.

Risk: Lambda is less suited for long-running streaming compute. CueFlow keeps handlers short and moves work to SQS.

## DynamoDB vs RDS

Decision: use DynamoDB.

Why: access patterns are key-value and session-oriented: user history, conversation chunks, cue list, and connection state.

Risk: relational ad hoc queries are limited. The single-table model is designed around known read paths.

## DynamoDB + S3 Hybrid Storage

Decision: use DynamoDB for queryable metadata and S3 for transcript and summary objects.

Why: full transcripts can grow and are cheaper to keep as objects. Metadata remains fast to query.

Risk: two stores must remain consistent. CueFlow writes chunk metadata and raw objects before AI work.

## OpenAI Provider vs Deterministic Mock

Decision: use OpenAI for deployed cue and summary workers while keeping deterministic mock AI for unit tests and local fallback.

Why: the deployed demo must show real AI behavior. The mock provider keeps domain and worker tests stable without spending model tokens or requiring network access.

Risk: OpenAI calls add latency, cost, and key-management requirements. CueFlow stores the key in Secrets Manager and keeps provider selection isolated behind the AI interface.

## Serverless Cost Optimization vs Runtime Control

Decision: use serverless managed services.

Why: the demo workload is small, bursty, and benefits from pay-per-use services.

Risk: runtime tuning is less direct than a container service. CueFlow controls cost and latency through trigger policy and short context windows.
