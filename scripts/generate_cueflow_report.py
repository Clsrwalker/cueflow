import html
import zipfile
from pathlib import Path


OUT = Path(r"D:\CueFlow\CueFlow_Final_Report_Draft.docx")
CREATED = "2026-07-01T00:00:00Z"

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def escape_xml(value: object) -> str:
    return html.escape(str(value), quote=False)


def run(text: str, bold: bool = False, italic: bool = False) -> str:
    props = []
    if bold:
        props.append("<w:b/>")
    if italic:
        props.append("<w:i/>")
    rpr = f"<w:rPr>{''.join(props)}</w:rPr>" if props else ""
    return f'<w:r>{rpr}<w:t xml:space="preserve">{escape_xml(text)}</w:t></w:r>'


def para(text: str = "", style: str = "Normal", align: str | None = None, bold: bool = False, italic: bool = False) -> str:
    ppr = []
    if style:
        ppr.append(f'<w:pStyle w:val="{style}"/>')
    if align:
        ppr.append(f'<w:jc w:val="{align}"/>')
    ppr_xml = f"<w:pPr>{''.join(ppr)}</w:pPr>" if ppr else ""
    runs: list[str] = []
    for index, line in enumerate(str(text).split("\n")):
        if index:
            runs.append("<w:r><w:br/></w:r>")
        runs.append(run(line, bold=bold, italic=italic))
    return f"<w:p>{ppr_xml}{''.join(runs)}</w:p>"


def page_break() -> str:
    return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'


def placeholder(text: str) -> str:
    return para(text, style="Placeholder", align="center")


def code_block(code: str) -> str:
    blocks = [para("```mermaid", style="Code")]
    for line in code.strip("\n").split("\n"):
        blocks.append(para(line.rstrip(), style="Code"))
    blocks.append(para("```", style="Code"))
    return "".join(blocks)


def table(rows: list[list[str]]) -> str:
    grid_cols = len(rows[0]) if rows else 1
    grid = "".join('<w:gridCol w:w="2400"/>' for _ in range(grid_cols))
    out = [
        "<w:tbl>",
        '<w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>'
        '<w:top w:val="single" w:sz="6" w:space="0" w:color="A6A6A6"/>'
        '<w:left w:val="single" w:sz="6" w:space="0" w:color="A6A6A6"/>'
        '<w:bottom w:val="single" w:sz="6" w:space="0" w:color="A6A6A6"/>'
        '<w:right w:val="single" w:sz="6" w:space="0" w:color="A6A6A6"/>'
        '<w:insideH w:val="single" w:sz="6" w:space="0" w:color="D9D9D9"/>'
        '<w:insideV w:val="single" w:sz="6" w:space="0" w:color="D9D9D9"/>'
        "</w:tblBorders></w:tblPr>",
        f"<w:tblGrid>{grid}</w:tblGrid>",
    ]
    for row_index, row in enumerate(rows):
        out.append("<w:tr>")
        for cell in row:
            shade = '<w:shd w:fill="EAF2F8"/>' if row_index == 0 else ""
            out.append(f'<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/>{shade}</w:tcPr>')
            for line in str(cell).split("\n"):
                out.append(para(line, style="TableText", bold=(row_index == 0)))
            out.append("</w:tc>")
        out.append("</w:tr>")
    out.append("</w:tbl>")
    return "".join(out)


def bullets(items: list[str]) -> str:
    return "".join(para(f"- {item}") for item in items)


HIGH_LEVEL_MERMAID = """
flowchart LR
  Browser[Mobile-first React client]
  HttpApi[API Gateway HTTP API]
  WsApi[API Gateway WebSocket API]
  RestLambda[REST Lambda]
  WsLambda[WebSocket Lambda]
  CueQueue[SQS cue queue]
  SummaryQueue[SQS summary queue]
  CueWorker[Cue worker Lambda]
  SummaryWorker[Summary worker Lambda]
  Ddb[(DynamoDB metadata)]
  S3[(S3 transcript and summary objects)]
  Secrets[Secrets Manager OpenAI key]
  OpenAI[OpenAI Responses API]
  CloudWatch[CloudWatch logs dashboard alarms]

  Browser -->|REST create/list/end/history| HttpApi --> RestLambda
  Browser <-->|sendTranscript / cue events| WsApi --> WsLambda
  RestLambda --> Ddb
  RestLambda --> S3
  RestLambda --> SummaryQueue
  WsLambda --> Ddb
  WsLambda --> S3
  WsLambda --> CueQueue
  CueQueue --> CueWorker
  SummaryQueue --> SummaryWorker
  CueWorker --> Ddb
  CueWorker --> Secrets
  CueWorker --> OpenAI
  CueWorker -->|cue.created| WsApi
  SummaryWorker --> Ddb
  SummaryWorker --> S3
  SummaryWorker --> Secrets
  SummaryWorker --> OpenAI
  SummaryWorker -->|summary.ready| WsApi
  RestLambda --> CloudWatch
  WsLambda --> CloudWatch
  CueWorker --> CloudWatch
  SummaryWorker --> CloudWatch
"""

SEQUENCE_MERMAID = """
sequenceDiagram
  participant Client as Browser client
  participant REST as API Gateway HTTP API
  participant WS as API Gateway WebSocket
  participant WSL as WebSocket Lambda
  participant DDB as DynamoDB
  participant S3 as S3
  participant SQS as SQS cue queue
  participant Worker as Cue worker Lambda
  participant AI as OpenAI

  Client->>REST: POST /conversations
  REST-->>Client: ACTIVE conversation id
  Client->>WS: connect?conversationId&userId
  WS->>WSL: $connect
  WSL->>DDB: put connection record
  Client->>WS: sendTranscript chunk
  WS->>WSL: route sendTranscript
  WSL->>S3: put raw transcript chunk
  WSL->>DDB: put transcript metadata
  WSL->>SQS: enqueue cue job when trigger fires
  WSL-->>Client: transcript.ack
  SQS->>Worker: deliver cue job
  Worker->>DDB: load recent transcript metadata
  Worker->>AI: generate cue with prepared note context
  Worker->>DDB: put cue metadata
  Worker->>WS: postToConnection cue.created
  WS-->>Client: cue.created
  Client->>REST: POST /conversations/{id}/end
  REST->>SQS: enqueue summary job
"""

DATA_MODEL_MERMAID = """
erDiagram
  USER ||--o{ CONVERSATION : owns
  USER ||--o{ PREPARED_NOTE : writes
  CONVERSATION ||--o{ TRANSCRIPT_CHUNK : contains
  CONVERSATION ||--o{ AI_CUE : produces
  CONVERSATION ||--o| SUMMARY : has
  CONVERSATION ||--o{ WEBSOCKET_CONNECTION : keeps

  USER {
    string userId
    string email
  }
  CONVERSATION {
    string conversationId
    string userId
    string status
    datetime startedAt
    datetime endedAt
    string summaryStatus
  }
  TRANSCRIPT_CHUNK {
    string chunkId
    string speaker
    string text
    string s3Key
    datetime createdAt
  }
  AI_CUE {
    string cueId
    string type
    string title
    string shortText
    number confidence
  }
  SUMMARY {
    string summaryObjectKey
    string status
    datetime createdAt
  }
  PREPARED_NOTE {
    string noteId
    string title
    string text
  }
  WEBSOCKET_CONNECTION {
    string connectionId
    string conversationId
    number ttl
  }
"""

DEPLOY_MERMAID = """
flowchart LR
  Dev[Developer workstation or GitHub Actions]
  Install[npm ci / npm install]
  Validate[Test typecheck build synth]
  CDK[CDK app]
  CFN[CloudFormation deployment]
  AWS[AWS stacks]
  Frontend[S3 or API Gateway static frontend]
  APIs[HTTP API and WebSocket API]

  Dev --> Install --> Validate --> CDK --> CFN --> AWS
  AWS --> Frontend
  AWS --> APIs
"""


def build_content() -> str:
    content: list[str] = []
    content.append(para("CueFlow", style="Title", align="center"))
    content.append(para("Cloud-Native Real-Time Conversation Intelligence Platform", style="Subtitle", align="center"))
    content.append(para("CSCI 5411 Advanced Cloud Architecting - Final Term Project Report", style="Subtitle", align="center"))
    content.append(para("Summer 2026", style="Subtitle", align="center"))
    content.append(table([
        ["Field", "Value"],
        ["Student", "[Insert student name]"],
        ["Student ID", "[Insert Banner ID]"],
        ["Project", "CueFlow"],
        ["Draft date", "July 1, 2026"],
        ["Repository", "[Insert private GitHub/GitLab repository URL]"],
        ["Deployment URL", "[Insert current deployed HTTPS frontend URL after final deploy]"],
    ]))
    content.append(para("Draft note: this DOCX is intentionally editable. Replace placeholders with final screenshots, exact student details, and the final deployed URL before exporting to PDF.", style="Caption"))
    content.append(page_break())

    content.append(para("Table of Contents", style="Heading1"))
    toc = [
        "Executive Summary",
        "Problem and Motivation",
        "Functional Requirements and User Stories",
        "Non-Functional Requirements",
        "Implemented System",
        "System Architecture",
        "Real-Time Conversation Flow",
        "Data Storage Design",
        "AI Design",
        "Frontend and UX Design",
        "AWS Service Selection and Trade-Offs",
        "Deployment, IaC, and CI/CD",
        "Security and Privacy",
        "AWS Well-Architected Review",
        "Testing and Validation",
        "Cost Analysis",
        "Limitations and Future Work",
        "Responsible Use of AI",
        "Conclusion",
        "References",
        "Appendix: Mermaid Source",
    ]
    for index, title in enumerate(toc, start=1):
        content.append(para(f"{index}. {title}"))
    content.append(page_break())

    content.append(para("1. Executive Summary", style="Heading1"))
    content.append(para("CueFlow is a mobile-first, cloud-native conversation intelligence platform designed for live meetings, interviews, and one-on-one technical discussions. The user signs in, prepares reusable notes, starts a live conversation, speaks through the browser microphone, receives real-time AI cue cards, ends the session, and later reviews the saved transcript, cue history, and structured summary."))
    content.append(para("The system is not a static note-taking application. Its main value is the real-time path: final transcript chunks are sent through an API Gateway WebSocket route, persisted in DynamoDB and S3, evaluated by a trigger policy, queued through SQS, processed by Lambda workers, and converted into concise AI cues using OpenAI. The end-of-session summary follows a separate asynchronous worker path so that ending a session does not block on model latency."))
    content.append(para("CueFlow demonstrates the main cloud architecture requirements for the CSCI 5411 project: multiple managed AWS services, persistent state in more than one storage solution, real protocol traffic through HTTP and WebSocket APIs, event-driven processing, Infrastructure as Code through AWS CDK, CI validation through GitHub Actions, and a design review across all six AWS Well-Architected Framework pillars."))

    content.append(para("2. Problem and Motivation", style="Heading1"))
    content.append(para("Live conversations create a different problem from after-the-fact note taking. A participant may need help while the conversation is still happening: what to say next, how to explain a cloud trade-off, how to answer a technical question, or which risk should be raised before a decision is made. Traditional notes capture information after the user has already lost the moment."))
    content.append(para("CueFlow addresses this problem by combining prepared context, live transcript processing, and compact AI cue cards. Prepared Notes let the user supply context such as a course rubric, interview focus, or project architecture summary. The live workspace keeps the transcript and AI cues visible together. After the session, CueFlow converts the saved transcript into a structured summary for review."))
    content.append(table([
        ["Project aspect", "CueFlow decision"],
        ["Primary users", "Students, job seekers, presenters, and meeting participants who need real-time conversational support."],
        ["Core value", "Live cue cards and post-session summaries based on the actual conversation context."],
        ["Cloud focus", "Serverless real-time workflow using REST, WebSocket, SQS, Lambda, DynamoDB, S3, Secrets Manager, and CloudWatch."],
        ["AI role", "OpenAI generates high-signal cue cards during the conversation and structured summaries after the session."],
    ]))
    content.append(para("Table 1. CueFlow project overview.", style="Caption"))

    content.append(para("3. Functional Requirements and User Stories", style="Heading1"))
    content.append(para("The functional scope is organized around the user's conversation workflow rather than around individual AWS services. Must-have requirements cover account entry, prepared context, live transcription, real-time cues, end-session summaries, and persisted records. Nice-to-have requirements are explicitly separated from the MVP so the report does not overclaim production features."))
    content.append(table([
        ["Priority", "Actor", "User story", "Implementation status"],
        ["Must-have", "Registered or demo user", "As a user, I can sign in or register through the CueFlow UI so my sessions and prepared notes are separated by user identity.", "Implemented as demo/local UI auth with backend user isolation through x-cueflow-user-id. Production auth is future work."],
        ["Must-have", "User", "As a user, I can create, edit, select, and delete Prepared Notes so AI cues and summaries can use relevant context.", "Implemented with backend persistence for prepared notes and UI management screens."],
        ["Must-have", "User", "As a user, I can start a live conversation and see transcript text appear inside the conversation page.", "Implemented through browser STT and cloud transcript chunk ingestion."],
        ["Must-have", "User", "As a user, I can receive concise AI cues while the conversation is active.", "Implemented through WebSocket sendTranscript, SQS cue queue, cue worker, OpenAI provider, and cue.created WebSocket push."],
        ["Must-have", "User", "As a user, I can end a session and receive a structured summary.", "Implemented through POST /conversations/{id}/end and asynchronous summary worker."],
        ["Must-have", "User", "As a user, I can open My Records and review prior conversations, transcript chunks, cues, and summaries.", "Implemented through REST history, transcript, cues, and summary APIs backed by DynamoDB and S3."],
        ["Nice-to-have", "User", "As a user, I can delete or archive old conversation records permanently.", "Not part of the current MVP; current deletion behavior is a client-side view action."],
        ["Nice-to-have", "Admin/operator", "As an operator, I can inspect health through logs, metrics, dashboard, and alarms.", "Implemented through CloudWatch logs, dashboard, alarms, and structured Lambda logs."],
    ]))
    content.append(para("Table 2. Prioritized CueFlow user stories and current status.", style="Caption"))

    content.append(para("4. Non-Functional Requirements", style="Heading1"))
    content.append(para("The main non-functional requirements are chosen to support a real-time but cost-conscious course demo. They are measurable so the design can be defended during the one-on-one meeting. The targets are design goals and should be validated further with deployed load tests if CueFlow becomes a production system."))
    content.append(table([
        ["Requirement", "Target", "Architecture impact"],
        ["Transcript ingest latency", "p95 under 300 ms", "WebSocket Lambda validates, persists, evaluates trigger state, and enqueues work without waiting for AI."],
        ["Cue generation latency", "p95 under 4 seconds; p99 under 8 seconds", "SQS and short context windows isolate model latency from the hot ingest path."],
        ["Summary latency", "p95 under 15 seconds after session end", "End request enqueues summary generation and returns while the worker runs asynchronously."],
        ["Availability", "99.9 percent target for course MVP", "API Gateway, Lambda, DynamoDB, SQS, and S3 are managed services with built-in scaling."],
        ["Durability and RPO", "RPO under 1 minute", "Transcript chunks are persisted to S3 and metadata to DynamoDB before AI generation begins."],
        ["Recovery and RTO", "RTO under 10 minutes for redeploy", "CDK and GitHub Actions can rebuild the environment from source when credentials are available."],
        ["Scalability", "100 concurrent demo conversations", "Serverless compute and queue buffering avoid fixed-capacity servers."],
        ["Retention", "30 days for demo transcript objects", "S3 lifecycle rules expire raw transcript and summary objects."],
        ["Cost", "Course-demo budget", "Use pay-per-use services, trigger-based AI calls, and short log retention."],
        ["Maintainability", "Main branch validation", "CI runs install, tests, typecheck, build, and CDK synth."],
    ]))
    content.append(para("Table 3. Non-functional requirements and architectural impact.", style="Caption"))

    content.append(para("5. Implemented System", style="Heading1"))
    content.append(para("CueFlow is implemented as a TypeScript monorepo with four workspaces: frontend, backend, shared, and infra. The frontend owns the mobile-first React experience. The backend owns REST handlers, WebSocket handlers, queue workers, storage abstractions, and AI providers. The shared workspace defines domain types and validation helpers. The infra workspace defines AWS resources through CDK."))
    content.append(table([
        ["Area", "Implemented responsibility"],
        ["frontend", "React/Vite mobile-first UI, demo auth screens, Sessions, Prepared Notes, live transcript/cue workspace, history and summary views."],
        ["backend", "Conversation service, REST routes, WebSocket routes, cue and summary workers, OpenAI provider, mock provider, AWS adapters."],
        ["shared", "Conversation, cue, transcript, summary, WebSocket event types, key builders, and input validation."],
        ["infra", "CDK stacks for DynamoDB, S3, SQS, API Gateway HTTP/WebSocket, Lambda, Secrets Manager wiring, frontend hosting, CloudWatch."],
        ["docs", "Architecture, API contract, NFRs, trade-offs, Well-Architected review, and demo script."],
        ["CI", "GitHub Actions workflow for npm ci, tests, typecheck, build, synth, and optional deploy."],
    ]))
    content.append(para("Table 4. Implemented code areas and responsibilities.", style="Caption"))

    content.append(para("6. System Architecture", style="Heading1"))
    content.append(para("CueFlow uses a serverless architecture with a clear separation between the interactive edge path and asynchronous AI processing. HTTP REST requests handle lifecycle and history operations. WebSocket traffic handles real-time transcript ingestion, transcript acknowledgements, and pushed cue events. Lambda functions keep compute stateless. DynamoDB stores queryable metadata, S3 stores larger transcript and summary objects, and SQS decouples AI work from the live transcript path."))
    content.append(placeholder("[PLACEHOLDER: Insert rendered high-level architecture diagram here.]"))
    content.append(para("Figure 1. CueFlow high-level architecture showing the mobile-first client, REST and WebSocket APIs, Lambda handlers, SQS workers, DynamoDB, S3, Secrets Manager, OpenAI, and CloudWatch.", style="Caption"))
    content.append(para("Mermaid source for Figure 1 is included in Appendix A.", style="Caption"))
    content.append(table([
        ["Tier", "Components", "Role"],
        ["Presentation", "React + Vite client", "Mobile-first UI for sessions, prepared notes, live workspace, and history."],
        ["API and edge", "API Gateway HTTP API and WebSocket API", "Expose REST operations and real-time transcript/cue events over HTTPS/WSS."],
        ["Application", "Lambda REST handler, WebSocket handler, cue worker, summary worker", "Validate requests, persist state, enqueue jobs, call OpenAI, and push events."],
        ["Data", "DynamoDB and S3", "Store metadata in DynamoDB and larger transcript/summary objects in S3."],
        ["Integration", "SQS", "Buffer cue and summary jobs, provide retry and DLQ behavior."],
        ["Operations", "CloudWatch and CDK", "Provide logs, metrics, alarms, dashboard, and repeatable infrastructure deployment."],
    ]))
    content.append(para("Table 5. CueFlow architecture tiers.", style="Caption"))

    content.append(para("7. Real-Time Conversation Flow", style="Heading1"))
    content.append(para("The real-time workflow begins when the user presses Start. The REST API creates an ACTIVE conversation record. The browser then opens a WebSocket connection scoped to that conversation and user. Browser speech recognition or the cloud transcription fallback converts microphone audio into final text chunks. Final chunks are sent with the sendTranscript WebSocket action."))
    content.append(para("The WebSocket Lambda validates the message, stores a raw transcript object in S3, stores transcript metadata in DynamoDB, evaluates whether a cue should be generated, and enqueues a cue job if the trigger fires. It immediately pushes transcript.ack to the client. The cue worker later receives the SQS job, loads recent context, calls OpenAI with any Prepared Note context, stores the resulting cue, and pushes cue.created to active WebSocket connections."))
    content.append(placeholder("[PLACEHOLDER: Insert rendered live transcript-to-cue sequence diagram here.]"))
    content.append(para("Figure 2. Critical live workflow from conversation creation to transcript ingestion, cue generation, and cue delivery.", style="Caption"))
    content.append(para("Mermaid source for Figure 2 is included in Appendix B.", style="Caption"))

    content.append(para("8. Data Storage Design", style="Heading1"))
    content.append(para("CueFlow uses two storage solutions because the data has two different access patterns. Conversation metadata, transcript chunk metadata, cue metadata, WebSocket connection records, and prepared-note records need fast key-based reads and list operations. DynamoDB fits those query patterns and avoids fixed database capacity management. Full transcript and summary payloads can grow larger and are naturally object-like, so they are stored in S3 with object keys referenced from metadata."))
    content.append(table([
        ["Data type", "Primary store", "Reason"],
        ["Conversation metadata", "DynamoDB", "Fast lookup by conversation id and user history listing."],
        ["Transcript chunk metadata", "DynamoDB", "Queryable ordered chunk list for the UI and workers."],
        ["Raw transcript chunk object", "S3", "Stores the full payload outside the metadata item size path."],
        ["Full transcript", "S3", "Generated at session end and may grow beyond a small metadata record."],
        ["Cue metadata", "DynamoDB", "Small, queryable records loaded by conversation history and live UI."],
        ["Summary object", "S3 plus DynamoDB status", "Keep structured summary payload in object storage while metadata tracks readiness."],
        ["WebSocket connection", "DynamoDB", "Supports fanout and cleanup for active connection ids."],
        ["Prepared Notes", "DynamoDB", "Reusable prompt context scoped to user identity."],
    ]))
    content.append(para("Table 6. Storage responsibilities across DynamoDB and S3.", style="Caption"))
    content.append(placeholder("[PLACEHOLDER: Insert rendered data model diagram here.]"))
    content.append(para("Figure 3. CueFlow data model across users, conversations, transcript chunks, cues, summaries, prepared notes, and WebSocket connections.", style="Caption"))
    content.append(para("Mermaid source for Figure 3 is included in Appendix C.", style="Caption"))

    content.append(para("9. AI Design", style="Heading1"))
    content.append(para("CueFlow uses OpenAI through backend Lambda and worker code. The OpenAI key is not exposed to the frontend; deployed functions read it through Secrets Manager or backend environment configuration. The AI interface is abstracted so local unit tests can use a deterministic mock provider without network calls or token spend."))
    content.append(para("Live cue generation is intentionally short and practical. The system asks for one compact cue card, not a long answer. Cue types include CONCEPT, DECISION, RISK, ACTION, and SUMMARY. The provider normalizes title length, removes title/content duplication, clips overly long text, and allows the model to return NONE when the transcript is filler or not useful."))
    content.append(para("Prepared Notes are passed as prompt context when selected. This allows a user to add domain context, such as the course rubric or a project architecture brief, without hard-coding that context in the application. Summary generation happens after the session ends and produces a structured summary with key topics, action items, and risks."))
    content.append(table([
        ["AI behavior", "Implementation decision", "Trade-off"],
        ["Live cues", "OpenAI cue worker receives recent transcript context and optional Prepared Note context.", "Model latency is asynchronous; the UI must tolerate brief pending time."],
        ["Cue trigger", "Backend trigger policy is broad for questions, help requests, decisions, risks, and AI-review windows, with cooldown and rate-limit controls.", "Broader triggers improve responsiveness but require filtering to avoid noisy cards."],
        ["Summary", "Summary worker runs after End and persists summary output.", "Eventually consistent summary is more reliable than blocking the end-session request."],
        ["Testing", "Mock AI provider keeps unit tests deterministic.", "Mock behavior is not a substitute for final deployed AI quality checks."],
    ]))
    content.append(para("Table 7. AI design decisions and trade-offs.", style="Caption"))

    content.append(para("10. Frontend and UX Design", style="Heading1"))
    content.append(para("The frontend is designed around a mobile-first workflow but remains usable on desktop. The first user-visible screen is the product experience, not a marketing landing page. The main screens are login/register, Sessions, user sidebar/profile management, Prepared Notes manager, live conversation workspace, and persisted history/summary views."))
    content.append(para("The live conversation page is the most important UI. It places transcript and AI cue/summary context in the same workspace so the user can read cues without leaving the conversation. Prepared Notes are managed separately so notes do not crowd the transcript area during the live session."))
    for index, caption in enumerate([
        "CueFlow login and registration screen.",
        "Sessions home showing My Records and selected Prepared Notes.",
        "Prepared Notes manager with create, edit, save, and delete behavior.",
        "Live conversation workspace with transcript and AI cue cards visible together.",
        "Persisted session history with transcript, cue history, and summary.",
    ], start=4):
        content.append(placeholder(f"[PLACEHOLDER: Insert screenshot for Figure {index}.]"))
        content.append(para(f"Figure {index}. {caption}", style="Caption"))

    content.append(para("11. AWS Service Selection and Trade-Offs", style="Heading1"))
    content.append(table([
        ["Decision", "Chosen option", "Alternative considered", "Rationale and risk"],
        ["Compute", "AWS Lambda", "ECS Fargate", "Lambda fits bursty, event-driven work and lowers operations. Risk: less control for long-running streaming compute."],
        ["Real-time delivery", "API Gateway WebSocket", "REST polling", "Server push is better for live cues. Risk: connection state must be stored and cleaned up."],
        ["Async processing", "SQS workers", "Synchronous OpenAI call in request path", "Queues keep transcript ingest responsive and add retry/DLQ behavior. Risk: UI sees eventual consistency."],
        ["Metadata storage", "DynamoDB", "RDS", "Known key-value access patterns fit DynamoDB. Risk: limited ad hoc relational querying."],
        ["Large object storage", "S3", "Store all content in DynamoDB", "S3 is cheaper and more natural for full transcript/summary objects. Risk: two-store consistency must be handled."],
        ["AI provider", "OpenAI", "Bedrock or only mock AI", "OpenAI gives practical cue quality for demo; mock keeps tests deterministic. Risk: external provider latency, cost, and key management."],
        ["Frontend hosting", "S3/CloudFront or API Gateway HTTPS fallback", "Local-only frontend", "Cloud hosting demonstrates deployable app and HTTPS microphone support. Risk: Learner Lab may restrict CloudFront."],
    ]))
    content.append(para("Table 8. Major AWS and technology trade-offs.", style="Caption"))

    content.append(para("12. Deployment, IaC, and CI/CD", style="Heading1"))
    content.append(para("All cloud resources are defined in the AWS CDK TypeScript app. The stack design separates storage, queues, APIs, frontend hosting, and monitoring. The API stack defines HTTP API routes, WebSocket routes, Lambda handlers, Lambda workers, environment variables, resource grants, and SQS event sources. The frontend stack can use CloudFront/S3 by default or an API Gateway HTTPS static frontend fallback when Learner Lab policies restrict CloudFront."))
    content.append(table([
        ["Stack", "Resources"],
        ["CueFlowStorage-dev", "DynamoDB single-table metadata store and encrypted S3 data bucket."],
        ["CueFlowQueues-dev", "SQS cue and summary queues plus dead-letter queues."],
        ["CueFlowApi-dev", "HTTP API, WebSocket API, REST Lambda, WebSocket Lambda, cue worker, summary worker."],
        ["CueFlowFrontend-dev", "Frontend bucket, CloudFront distribution by default, or API Gateway static fallback."],
        ["CueFlowMonitoring-dev", "CloudWatch dashboard and alarms."],
    ]))
    content.append(para("Table 9. CDK stack responsibilities.", style="Caption"))
    content.append(placeholder("[PLACEHOLDER: Insert rendered deployment flow diagram or CI/CD screenshot here.]"))
    content.append(para("Figure 9. Deployment and validation flow from source code through npm validation, CDK synth, and AWS stack deployment.", style="Caption"))
    content.append(para("Mermaid source for Figure 9 is included in Appendix D.", style="Caption"))
    content.append(para("GitHub Actions validates pull requests and pushes to main with npm ci, npm test, npm run typecheck, npm run build, and npm run synth. Deployment is present but optional because AWS Learner Lab credentials are short-lived; the deploy job runs on main only when AWS_ROLE_ARN is configured."))

    content.append(para("13. Security and Privacy", style="Heading1"))
    content.append(para("CueFlow avoids exposing cloud or AI credentials to the browser. OpenAI calls happen behind Lambda and the deployed key is read from Secrets Manager. API traffic uses HTTPS and WSS endpoints. S3 and SQS use managed encryption. The S3 data bucket blocks public access and enforces SSL. DynamoDB stores metadata in managed AWS infrastructure and point-in-time recovery is enabled in the CDK definition."))
    content.append(para("The main security limitation is identity. The course MVP includes login/register UI and backend per-user isolation using x-cueflow-user-id, but it does not implement production Cognito/JWT authentication or password-backed accounts. In production, CueFlow should add Cognito or an external OIDC provider, API Gateway authorizers, stricter CORS origins, and authorization checks at every user-scoped route."))
    content.append(table([
        ["Control", "Current implementation", "Production improvement"],
        ["Transport security", "HTTPS and WSS endpoints", "Restrict CORS to approved production origins."],
        ["AI key management", "Secrets Manager / backend environment; no frontend key", "Rotate secrets and scope IAM permissions further."],
        ["Storage security", "S3 block public access, SSL enforcement, managed encryption", "Use stricter retention and access audit policies."],
        ["Queue security", "SQS managed encryption and Lambda grants", "Add cross-account controls only if multi-account deployment is needed."],
        ["Identity", "Demo auth plus x-cueflow-user-id", "Cognito/JWT authorizer with real account lifecycle."],
    ]))
    content.append(para("Table 10. Security controls and production improvements.", style="Caption"))

    content.append(para("14. AWS Well-Architected Review", style="Heading1"))
    content.append(table([
        ["Pillar", "CueFlow evidence", "Trade-off"],
        ["Operational Excellence", "CDK, GitHub Actions, README, demo script, structured logs, CloudWatch dashboard and alarms.", "Learner Lab short-lived credentials make manual deploy more reliable than fully automated deploy."],
        ["Security", "HTTPS/WSS, Secrets Manager, encrypted S3/SQS, private data bucket, least-privilege resource grants.", "MVP auth is minimal; production should add Cognito/JWT and restricted CORS."],
        ["Reliability", "Transcript chunks are persisted before AI work, SQS queues have DLQs, cue records can be fetched after reconnect.", "Cloud integration tests are mocked locally due to lack of permanent AWS account."],
        ["Performance Efficiency", "WebSocket push avoids polling, Lambda scales with events, SQS smooths bursts, short context windows reduce AI latency.", "Summaries are eventually consistent after session end."],
        ["Cost Optimization", "Pay-per-use Lambda/API Gateway/DynamoDB/S3/SQS, trigger-based AI generation, short log retention.", "CloudWatch dashboard/alarms and OpenAI calls add usage-based costs."],
        ["Sustainability", "Serverless reduces idle compute, WebSocket avoids polling, S3 lifecycle expires demo objects, AI calls are trigger-limited.", "External OpenAI energy/cost profile is outside direct AWS control."],
    ]))
    content.append(para("Table 11. CueFlow review across all six AWS Well-Architected pillars.", style="Caption"))

    content.append(para("15. Testing and Validation", style="Heading1"))
    content.append(para("The current workspace was validated on July 1, 2026 with local test, typecheck, production build, and CDK synth commands. These commands do not replace deployed AWS smoke testing, but they show that the codebase is internally consistent and deployable through CDK."))
    content.append(table([
        ["Validation", "Command", "Result"],
        ["Unit tests", "npm test", "Passed. shared: 2 test files / 8 tests. backend: 14 test files / 73 tests."],
        ["TypeScript", "npm run typecheck", "Passed across shared, frontend, backend, and infra workspaces."],
        ["Production build", "npm run build", "Passed. Frontend Vite build and backend/infra TypeScript builds completed."],
        ["CDK synth", "npm run synth", r"Passed. Synthesized to D:\CueFlow\infra\cdk.out with stacks CueFlowStorage-dev, CueFlowQueues-dev, CueFlowApi-dev, CueFlowFrontend-dev, CueFlowMonitoring-dev."],
    ]))
    content.append(para("Table 12. Local validation evidence for the report draft.", style="Caption"))
    content.append(placeholder("[PLACEHOLDER: Insert CI run screenshot or terminal validation screenshot here.]"))
    content.append(para("Figure 10. Validation evidence showing tests, typecheck, build, and CDK synth passing.", style="Caption"))
    content.append(para("Recommended deployed demo checks: create a user, add a Prepared Note, start a session, allow microphone permission, speak a cloud architecture question, confirm transcript.ack, confirm cue.created, end the session, and reload My Records to verify persisted history."))

    content.append(para("16. Cost Analysis", style="Heading1"))
    content.append(para("The cost model is designed for a small course-demo workload rather than a production SaaS workload. Exact regional pricing should be verified in the AWS Pricing Calculator before final submission, but the architecture intentionally uses pay-per-use services so idle cost remains low."))
    content.append(table([
        ["Service", "Cost driver", "Expected course-demo cost behavior"],
        ["API Gateway HTTP API", "Number of REST requests", "Low for demo traffic; scales with session/history calls."],
        ["API Gateway WebSocket", "Connection minutes and messages", "Low for short live sessions; more efficient than polling for cues."],
        ["Lambda", "Invocations and duration", "Low because handlers are short and AI work is isolated in workers."],
        ["DynamoDB on-demand", "Read/write request units and storage", "Low for conversation metadata and cue records."],
        ["S3", "Stored transcript/summary objects and requests", "Low for text objects; lifecycle rules expire demo data after 30 days."],
        ["SQS", "Queue requests", "Low; adds reliability without persistent servers."],
        ["CloudWatch", "Logs, dashboard, alarms", "Small fixed/usage cost; useful for operations and grading evidence."],
        ["OpenAI", "Model input/output tokens and transcription calls", "Main variable cost; controlled by cue trigger policy and short context windows."],
    ]))
    content.append(para("Table 13. Course-demo cost drivers and expected behavior.", style="Caption"))

    content.append(para("17. Limitations and Future Work", style="Heading1"))
    content.append(para("CueFlow meets the course MVP goals, but several limitations should be stated clearly."))
    content.append(bullets([
        "Browser speech recognition is the ASR layer. The cloud real-time pipeline begins at final transcript text chunks, not raw streaming audio.",
        "Authentication is minimal. The backend uses x-cueflow-user-id for user isolation instead of Cognito/JWT.",
        "My Records deletion is currently a client-side view action; a persisted delete/archive API should be added.",
        "Cloud integration tests are mocked locally because Learner Lab credentials are temporary.",
        "CI/CD deploy requires a stable AWS_ROLE_ARN; manual deployment remains the practical Learner Lab path.",
        "Production CORS, rate limiting, audit logs, data export/delete workflows, and stronger privacy controls should be added before real users.",
    ]))
    content.append(para("Future improvements include Cognito Hosted UI or JWT authorizers, true cloud audio streaming ASR, persistent archive/delete endpoints, Playwright end-to-end tests, stable OIDC deployment, and richer observability dashboards for AI latency and cue quality."))

    content.append(para("18. Responsible Use of AI", style="Heading1"))
    content.append(para("CueFlow uses AI as an assistive layer, not as the source of truth for the conversation. The transcript remains the underlying record. Cue cards are short suggestions that the user can accept, ignore, or verify. Prepared Notes improve relevance but should not cause the model to invent facts outside the transcript. The OpenAI key is stored server-side and should never be placed in frontend code or committed to the repository."))
    content.append(table([
        ["Responsible AI concern", "CueFlow handling"],
        ["Privacy", "OpenAI calls happen through backend workers; frontend does not hold the API key. Users should avoid sensitive personal data in demo transcripts."],
        ["Transparency", "Report and demo explain that cues and summaries are AI-generated."],
        ["Reliability", "The UI presents cues as assistance, not authoritative decisions."],
        ["Testing", "Deterministic mock AI keeps unit tests stable without external model calls."],
        ["Disclosure", "AI-assisted code percentage: [insert final percentage before submission]."],
    ]))
    content.append(para("Table 14. Responsible AI considerations.", style="Caption"))

    content.append(para("19. Conclusion", style="Heading1"))
    content.append(para("CueFlow demonstrates a production-style cloud architecture within the constraints of a course project and AWS Learner Lab. It supports a meaningful user workflow, uses real HTTP and WebSocket traffic, persists state in DynamoDB and S3, uses event-driven SQS workers for AI tasks, integrates OpenAI securely through backend code, and defines cloud resources through CDK. The design also exposes realistic trade-offs: asynchronous AI improves reliability but adds eventual consistency, browser STT simplifies deployment but is not true cloud audio streaming, and demo auth is acceptable for the MVP but not for production."))
    content.append(para("For the one-on-one meeting, the strongest demo path is to start with the user workflow, then trace a transcript chunk end-to-end through WebSocket, Lambda, S3, DynamoDB, SQS, OpenAI, and back to the browser as a cue.created event. This shows both the product experience and the cloud architecture behind it."))

    content.append(para("20. References", style="Heading1"))
    references = [
        "Amazon Web Services. AWS Well-Architected Framework. https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html",
        "Amazon Web Services. AWS Lambda Developer Guide. https://docs.aws.amazon.com/lambda/latest/dg/welcome.html",
        "Amazon Web Services. Amazon API Gateway Developer Guide. https://docs.aws.amazon.com/apigateway/latest/developerguide/welcome.html",
        "Amazon Web Services. API Gateway WebSocket APIs. https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api.html",
        "Amazon Web Services. Amazon DynamoDB Developer Guide. https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html",
        "Amazon Web Services. Amazon S3 User Guide. https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html",
        "Amazon Web Services. Amazon SQS Developer Guide. https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html",
        "Amazon Web Services. AWS Secrets Manager User Guide. https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html",
        "Amazon Web Services. Amazon CloudWatch User Guide. https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/WhatIsCloudWatch.html",
        "Amazon Web Services. AWS CDK Developer Guide. https://docs.aws.amazon.com/cdk/v2/guide/home.html",
        "OpenAI. OpenAI API Documentation. https://platform.openai.com/docs",
        "React. React Documentation. https://react.dev/",
        "Vite. Vite Guide. https://vite.dev/guide/",
    ]
    for ref in references:
        content.append(para(ref, style="Reference"))

    content.append(page_break())
    content.append(para("Appendix A. High-Level Architecture Mermaid Source", style="Heading1"))
    content.append(code_block(HIGH_LEVEL_MERMAID))
    content.append(para("Appendix B. Real-Time Transcript-to-Cue Sequence Mermaid Source", style="Heading1"))
    content.append(code_block(SEQUENCE_MERMAID))
    content.append(para("Appendix C. Data Model Mermaid Source", style="Heading1"))
    content.append(code_block(DATA_MODEL_MERMAID))
    content.append(para("Appendix D. Deployment Flow Mermaid Source", style="Heading1"))
    content.append(code_block(DEPLOY_MERMAID))
    return "".join(content)


def document_xml(body: str) -> str:
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="{W_NS}" xmlns:r="{R_NS}">
  <w:body>
    {body}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>'''


def styles_xml() -> str:
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="{W_NS}">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="21"/><w:color w:val="1F2937"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="1200" w:after="260"/></w:pPr><w:rPr><w:b/><w:sz w:val="56"/><w:color w:val="0F172A"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="180"/></w:pPr><w:rPr><w:sz w:val="28"/><w:color w:val="334155"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="160"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="0F172A"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="80" w:after="180"/></w:pPr><w:rPr><w:i/><w:sz w:val="19"/><w:color w:val="475569"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Placeholder"><w:name w:val="Placeholder"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="160" w:after="80"/><w:pBdr><w:top w:val="dashed" w:sz="8" w:space="4" w:color="94A3B8"/><w:left w:val="dashed" w:sz="8" w:space="4" w:color="94A3B8"/><w:bottom w:val="dashed" w:sz="8" w:space="4" w:color="94A3B8"/><w:right w:val="dashed" w:sz="8" w:space="4" w:color="94A3B8"/></w:pBdr><w:shd w:fill="F8FAFC"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/><w:color w:val="334155"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="0"/><w:shd w:fill="F1F5F9"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/><w:color w:val="0F172A"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="19"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Reference"><w:name w:val="Reference"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:sz w:val="19"/></w:rPr></w:style>
</w:styles>'''


def write_docx() -> None:
    content_types = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>'''
    rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>'''
    doc_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
</Relationships>'''
    settings = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="{W_NS}"><w:compat/><w:zoom w:percent="100"/></w:settings>'''
    core = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>CueFlow Final Report Draft</dc:title>
  <dc:subject>CSCI 5411 Term Project</dc:subject>
  <dc:creator>Codex</dc:creator>
  <cp:keywords>CueFlow; AWS; serverless; WebSocket; OpenAI; DynamoDB; S3; SQS</cp:keywords>
  <dc:description>Editable draft final report for the CueFlow cloud-native term project.</dc:description>
  <cp:lastModifiedBy>Codex</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{CREATED}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{CREATED}</dcterms:modified>
</cp:coreProperties>'''
    app = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft Word</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <Company></Company>
  <LinksUpToDate>false</LinksUpToDate>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>16.0000</AppVersion>
</Properties>'''

    OUT.parent.mkdir(parents=True, exist_ok=True)
    body = build_content()
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", rels)
        archive.writestr("docProps/core.xml", core)
        archive.writestr("docProps/app.xml", app)
        archive.writestr("word/document.xml", document_xml(body))
        archive.writestr("word/styles.xml", styles_xml())
        archive.writestr("word/settings.xml", settings)
        archive.writestr("word/_rels/document.xml.rels", doc_rels)
    print(f"Wrote {OUT}")
    print(f"Size: {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    write_docx()
