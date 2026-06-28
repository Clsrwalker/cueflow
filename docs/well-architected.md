# AWS Well-Architected Review

## Operational Excellence

CueFlow uses CDK for infrastructure, GitHub Actions for CI/CD, structured logs in handler and worker code, and CloudWatch dashboard and alarms. The README and demo script document setup, validation, and deployment.

Trade-off: inline Lambda placeholders keep synth and deploy simple for the infrastructure phase. A later packaging step should wire compiled backend handlers into Lambda assets.

## Security

Cloud resources use HTTPS/WSS endpoints for APIs, S3 managed encryption, SQS managed encryption, DynamoDB managed persistence, and least-privilege grants from resources to functions. The default CloudFront frontend keeps the S3 bucket private; the Learner Lab S3 website fallback intentionally exposes only built static frontend assets. Credentials are not committed. Deployment credentials are expected through GitHub OIDC or local AWS profile configuration.

Trade-off: the course MVP does not include a full user identity system. A production version should add Cognito or a JWT authorizer and tighten CORS origins.

## Reliability

Transcript chunks are persisted before AI generation. SQS queues have DLQs. Cue jobs and summary jobs have pending, in-progress, completed, and failed states. Cue records remain fetchable by REST if a WebSocket connection is lost.

Trade-off: local tests mock AWS services. Cloud integration testing should be added when a stable AWS account is available.

## Performance Efficiency

WebSocket push avoids wasteful polling for cue delivery. Lambda scales with event volume. SQS smooths bursts. The cue worker uses a short context window to control provider latency.

Trade-off: summary generation is eventually consistent after session end. The UI exposes pending state.

## Cost Optimization

CueFlow uses serverless pay-per-use services, trigger-based AI generation, S3 lifecycle expiration for demo data, one-week log retention, and queues to avoid overprovisioned compute.

Trade-off: CloudWatch alarms and dashboard add small fixed cost but are useful for operations and grading.

## Sustainability

Serverless services reduce idle compute. Trigger policy avoids unnecessary AI calls. WebSocket push avoids continuous client polling. S3 lifecycle policies delete old demo transcript data.

Trade-off: deterministic mock AI reduces demo resource use but does not measure real model energy or latency behavior.
