import { useEffect, useMemo, useRef, useState } from "react";
import {
  History,
  ListRestart,
  MessageSquareText,
  Play,
  Radio,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import type { Conversation, ConversationSummary, Cue, CueType, TranscriptAckEvent, TranscriptChunk } from "@cueflow/shared";

type View = "live" | "history";
type ConnectionState = "idle" | "connected" | "replaying" | "summary-pending" | "summary-ready";

type HistoryRecord = {
  conversation: Conversation;
  transcript: TranscriptChunk[];
  cues: Cue[];
  summary: ConversationSummary | null;
};

const DEMO_TRANSCRIPT = [
  "We need to design the cloud architecture for CueFlow.",
  "The app should receive transcript chunks from a mobile client.",
  "Should we use WebSocket or REST polling for real-time AI cues?",
  "WebSocket seems better for pushing cue cards, but it adds connection state.",
  "We also need to store raw transcript and generated summaries.",
  "Maybe DynamoDB can store metadata and S3 can store full transcript objects.",
  "The main risk is AI latency, especially if every chunk calls the model.",
  "We should use SQS so transcript ingestion does not wait for the AI worker.",
  "At the end of the conversation, the system should generate a summary and action items.",
];

const CUE_STYLE: Record<CueType, string> = {
  CONCEPT: "concept",
  DECISION: "decision",
  RISK: "risk",
  ACTION: "action",
  SUMMARY: "summary",
};

function isoNow(): string {
  return new Date().toISOString();
}

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function durationLabel(startedAt: string, endedAt?: string | null): string {
  const end = endedAt ? Date.parse(endedAt) : Date.now();
  const seconds = Math.max(0, Math.round((end - Date.parse(startedAt)) / 1000));
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const rest = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}

function wordCount(text: string): number {
  return text.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?/g)?.length ?? 0;
}

function shouldTriggerCue(chunks: TranscriptChunk[], cues: Cue[]): boolean {
  const lastCue = cues[0];
  const window = lastCue
    ? chunks.slice(chunks.findIndex((chunk) => chunk.chunkId === lastCue.sourceChunkEnd) + 1)
    : chunks;
  const text = window.map((chunk) => chunk.text).join(" ");
  const lower = text.toLowerCase();
  return wordCount(text) > 60
    || text.includes("?")
    || [
      "choose",
      "compare",
      "trade-off",
      "should we",
      "risk",
      "latency",
      "failure",
      "cost",
      "security",
      "reliability",
      "websocket",
      "sqs",
      "dynamodb",
      "s3",
    ].some((keyword) => lower.includes(keyword));
}

function buildCue(conversationId: string, chunks: TranscriptChunk[]): Cue {
  const text = chunks.map((chunk) => chunk.text).join(" ");
  const lower = text.toLowerCase();
  const createdAt = isoNow();
  const sourceChunkStart = chunks[0]?.chunkId ?? "000001";
  const sourceChunkEnd = chunks[chunks.length - 1]?.chunkId ?? sourceChunkStart;

  if (/\b(risk|failure|latency|cost|security|reliability|uncertain|slow)\b/.test(lower)) {
    return {
      cueId: `cue_${createdAt.replace(/\D/g, "")}`,
      conversationId,
      type: "RISK",
      title: "Risk detected",
      shortText: "The transcript mentions reliability, latency, cost, security, or failure risk.",
      detailText: "Persist transcript chunks before AI processing and rely on queue retries so data is not lost.",
      sourceChunkStart,
      sourceChunkEnd,
      confidence: 0.86,
      createdAt,
      modelLatencyMs: 720,
    };
  }

  if (/\b(todo|next|need to|should implement|we should|action items)\b/.test(lower)) {
    return {
      cueId: `cue_${createdAt.replace(/\D/g, "")}`,
      conversationId,
      type: "ACTION",
      title: "Action item",
      shortText: "The conversation implies a concrete implementation step.",
      detailText: "Capture this item in the session summary so it remains visible after the live session ends.",
      sourceChunkStart,
      sourceChunkEnd,
      confidence: 0.84,
      createdAt,
      modelLatencyMs: 680,
    };
  }

  if (/\b(summary|recap|end conversation|session end)\b/.test(lower)) {
    return {
      cueId: `cue_${createdAt.replace(/\D/g, "")}`,
      conversationId,
      type: "SUMMARY",
      title: "Summary checkpoint",
      shortText: "The conversation is moving toward a structured recap.",
      detailText: "CueFlow can summarize key topics, action items, and risks when the session ends.",
      sourceChunkStart,
      sourceChunkEnd,
      confidence: 0.82,
      createdAt,
      modelLatencyMs: 690,
    };
  }

  if (/\b(websocket|polling|rest|lambda|fargate|choose|compare|trade-off|alternative|should we)\b/.test(lower)) {
    return {
      cueId: `cue_${createdAt.replace(/\D/g, "")}`,
      conversationId,
      type: "DECISION",
      title: "Architecture decision",
      shortText: "The transcript discusses alternatives or a cloud architecture choice.",
      detailText: "Use WebSocket for real-time cue delivery and REST for non-real-time history and summary retrieval.",
      sourceChunkStart,
      sourceChunkEnd,
      confidence: 0.88,
      createdAt,
      modelLatencyMs: 760,
    };
  }

  return {
    cueId: `cue_${createdAt.replace(/\D/g, "")}`,
    conversationId,
    type: "CONCEPT",
    title: "Cloud architecture concept",
    shortText: "The conversation introduces a cloud-native building block.",
    detailText: "Keep metadata, transcript objects, and async AI work separated so each tier has a clear responsibility.",
    sourceChunkStart,
    sourceChunkEnd,
    confidence: 0.8,
    createdAt,
    modelLatencyMs: 640,
  };
}

function buildSummary(conversationId: string, chunks: TranscriptChunk[]): ConversationSummary {
  const text = chunks.map((chunk) => chunk.text.trim()).filter(Boolean).join(" ");
  const sentences = text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  const keyTopics = [
    /\b(websocket|real-time)\b/i.test(text) && "WebSocket real-time delivery",
    /\b(rest|history|summary retrieval)\b/i.test(text) && "REST API lifecycle",
    /\b(sqs|queue|async)\b/i.test(text) && "SQS async processing",
    /\b(dynamodb|metadata)\b/i.test(text) && "DynamoDB metadata storage",
    /\b(s3|raw transcript|object storage|summary)\b/i.test(text) && "S3 transcript and summary storage",
    /\b(ai|cue|model)\b/i.test(text) && "AI cue generation",
    /\b(risk|failure|latency|reliability)\b/i.test(text) && "Cloud reliability and latency",
  ].filter(Boolean) as string[];

  const actionItems = sentences.filter((sentence) => /\b(todo|next|need to|should implement|we should|should generate)\b/i.test(sentence));
  const risks = sentences.filter((sentence) => /\b(risk|failure|latency|cost|security|reliability|uncertain|slow)\b/i.test(sentence));

  return {
    conversationId,
    summary: text
      ? `The session focused on ${(keyTopics.length ? keyTopics : ["conversation architecture"]).slice(0, 3).join(", ")}.`
      : "The conversation did not contain enough transcript content for a detailed summary.",
    keyTopics: keyTopics.length ? keyTopics : ["Conversation architecture"],
    actionItems: actionItems.length ? actionItems : ["Review generated cues and finalize the next implementation step."],
    risks: risks.length ? risks : ["No major risks were explicitly identified in the transcript."],
    createdAt: isoNow(),
  };
}

export default function App() {
  const [view, setView] = useState<View>("live");
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [transcript, setTranscript] = useState<TranscriptChunk[]>([]);
  const [cues, setCues] = useState<Cue[]>([]);
  const [summary, setSummary] = useState<ConversationSummary | null>(null);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string>("");
  const [manualText, setManualText] = useState("");
  const [lastAck, setLastAck] = useState<TranscriptAckEvent | null>(null);
  const [pendingCueJob, setPendingCueJob] = useState(false);
  const [pendingSummaryJob, setPendingSummaryJob] = useState(false);
  const [elapsedTick, setElapsedTick] = useState(0);

  const transcriptRef = useRef<TranscriptChunk[]>([]);
  const cuesRef = useRef<Cue[]>([]);
  const pendingCueRef = useRef(false);
  const replayTimersRef = useRef<number[]>([]);
  const workerTimersRef = useRef<number[]>([]);

  const activeHistory = history.find((record) => record.conversation.conversationId === selectedHistoryId) ?? history[0] ?? null;
  const liveDuration = conversation ? durationLabel(conversation.startedAt, conversation.endedAt) : "00:00";
  const displayedTranscript = view === "history" && activeHistory ? activeHistory.transcript : transcript;
  const displayedCues = view === "history" && activeHistory ? activeHistory.cues : cues;
  const displayedSummary = view === "history" && activeHistory ? activeHistory.summary : summary;

  const statusLabel = useMemo(() => {
    if (connectionState === "connected") return "Connected";
    if (connectionState === "replaying") return "Replay running";
    if (connectionState === "summary-pending") return "Summary pending";
    if (connectionState === "summary-ready") return "Summary ready";
    return "Idle";
  }, [connectionState]);

  useEffect(() => {
    if (!conversation || conversation.status !== "ACTIVE") return;
    const interval = window.setInterval(() => setElapsedTick((current) => current + 1), 1000);
    return () => window.clearInterval(interval);
  }, [conversation]);

  useEffect(() => () => {
    replayTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    workerTimersRef.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  function clearTimers() {
    replayTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    workerTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    replayTimersRef.current = [];
    workerTimersRef.current = [];
  }

  function startConversation() {
    clearTimers();
    const startedAt = isoNow();
    const nextConversation: Conversation = {
      conversationId: `conv_${Date.now().toString(36)}`,
      userId: "demo-user",
      status: "ACTIVE",
      startedAt,
      endedAt: null,
      cueCount: 0,
      summaryStatus: "NOT_STARTED",
    };
    transcriptRef.current = [];
    cuesRef.current = [];
    pendingCueRef.current = false;
    setConversation(nextConversation);
    setTranscript([]);
    setCues([]);
    setSummary(null);
    setLastAck(null);
    setPendingCueJob(false);
    setPendingSummaryJob(false);
    setConnectionState("connected");
    setElapsedTick(0);
    setView("live");
  }

  function appendTranscript(text: string) {
    if (!conversation || conversation.status !== "ACTIVE") return;
    const trimmed = text.trim();
    if (!trimmed) return;

    const createdAt = isoNow();
    const chunk: TranscriptChunk = {
      conversationId: conversation.conversationId,
      chunkId: `${transcriptRef.current.length + 1}`.padStart(6, "0"),
      speaker: "speaker_1",
      text: trimmed,
      clientTimestamp: createdAt,
      createdAt,
      s3Key: `raw/${conversation.conversationId}/chunks/${`${transcriptRef.current.length + 1}`.padStart(6, "0")}.json`,
    };

    const nextTranscript = [...transcriptRef.current, chunk];
    transcriptRef.current = nextTranscript;
    setTranscript(nextTranscript);
    setLastAck({
      eventType: "transcript.ack",
      conversationId: conversation.conversationId,
      chunkId: chunk.chunkId,
      receivedAt: createdAt,
    });

    if (!pendingCueRef.current && shouldTriggerCue(nextTranscript, cuesRef.current)) {
      pendingCueRef.current = true;
      setPendingCueJob(true);
      const timer = window.setTimeout(() => {
        const context = transcriptRef.current.slice(-3);
        const cue = buildCue(conversation.conversationId, context);
        const nextCues = [cue, ...cuesRef.current];
        cuesRef.current = nextCues;
        setCues(nextCues);
        setConversation((current) => current
          ? { ...current, cueCount: nextCues.length }
          : current);
        pendingCueRef.current = false;
        setPendingCueJob(false);
      }, 750);
      workerTimersRef.current.push(timer);
    }
  }

  function replayDemoTranscript() {
    if (!conversation || conversation.status !== "ACTIVE") return;
    replayTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    replayTimersRef.current = [];
    setConnectionState("replaying");
    DEMO_TRANSCRIPT.forEach((line, index) => {
      const timer = window.setTimeout(() => {
        appendTranscript(line);
        if (index === DEMO_TRANSCRIPT.length - 1) {
          setConnectionState("connected");
        }
      }, index * 1150);
      replayTimersRef.current.push(timer);
    });
  }

  function sendManualTranscript() {
    appendTranscript(manualText);
    setManualText("");
  }

  function endConversation() {
    if (!conversation || conversation.status !== "ACTIVE") return;
    replayTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    replayTimersRef.current = [];
    const endedAt = isoNow();
    const endedConversation: Conversation = {
      ...conversation,
      status: "ENDED",
      endedAt,
      summaryStatus: "PENDING",
      cueCount: cuesRef.current.length,
    };
    setConversation(endedConversation);
    setPendingSummaryJob(true);
    setConnectionState("summary-pending");

    const timer = window.setTimeout(() => {
      const nextSummary = buildSummary(endedConversation.conversationId, transcriptRef.current);
      const readyConversation: Conversation = {
        ...endedConversation,
        summaryStatus: "READY",
      };
      const record: HistoryRecord = {
        conversation: readyConversation,
        transcript: transcriptRef.current,
        cues: cuesRef.current,
        summary: nextSummary,
      };
      setConversation(readyConversation);
      setSummary(nextSummary);
      setHistory((current) => [record, ...current.filter((item) => item.conversation.conversationId !== readyConversation.conversationId)]);
      setSelectedHistoryId(readyConversation.conversationId);
      setPendingSummaryJob(false);
      setConnectionState("summary-ready");
    }, 950);
    workerTimersRef.current.push(timer);
  }

  function clearSession() {
    clearTimers();
    transcriptRef.current = [];
    cuesRef.current = [];
    pendingCueRef.current = false;
    setConversation(null);
    setTranscript([]);
    setCues([]);
    setSummary(null);
    setLastAck(null);
    setPendingCueJob(false);
    setPendingSummaryJob(false);
    setConnectionState("idle");
    setManualText("");
    setElapsedTick(0);
  }

  function openHistory(record: HistoryRecord) {
    setSelectedHistoryId(record.conversation.conversationId);
    setView("history");
  }

  return (
    <main className="phone-shell">
      <header className="app-header">
        <button className="brand-mark" aria-label="CueFlow live view" onClick={() => setView("live")}>
          <Sparkles size={22} strokeWidth={1.8} />
        </button>
        <div>
          <p className="eyebrow">Conversation Intelligence</p>
          <h1>CueFlow</h1>
        </div>
        <span className={`status-dot ${connectionState}`}>{statusLabel}</span>
      </header>

      <nav className="view-tabs" aria-label="CueFlow views">
        <button className={view === "live" ? "active" : ""} onClick={() => setView("live")}>
          <Radio size={17} /> Live Conversation
        </button>
        <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}>
          <History size={17} /> Conversation History
        </button>
      </nav>

      {view === "live" ? (
        <>
          <section className="session-panel">
            <div>
              <p className="panel-label">Live Conversation</p>
              <h2>{conversation ? dateLabel(conversation.startedAt) : "Ready"}</h2>
              <p className="session-meta">
                {conversation ? `${conversation.status} · ${liveDuration}` : "Start a session to open the local real-time channel."}
              </p>
            </div>
            <div className="metric-grid">
              <span><strong>{transcript.length}</strong> Transcript</span>
              <span><strong>{cues.length}</strong> AI Cues</span>
              <span><strong>{pendingCueJob ? 1 : 0}</strong> Queue</span>
            </div>
          </section>

          <section className="action-grid" aria-label="Conversation controls">
            <button className="primary-action" onClick={startConversation}>
              <Play size={20} /> Start Conversation
            </button>
            <button disabled={!conversation || conversation.status !== "ACTIVE"} onClick={replayDemoTranscript}>
              <ListRestart size={20} /> Replay Demo Transcript
            </button>
            <button disabled={!conversation || conversation.status !== "ACTIVE"} onClick={endConversation}>
              <Square size={18} /> End Conversation
            </button>
            <button onClick={clearSession}>
              <Trash2 size={18} /> Clear Session
            </button>
          </section>

          <section className="manual-send">
            <textarea
              value={manualText}
              placeholder="Add transcript chunk"
              rows={3}
              onChange={(event) => setManualText(event.target.value)}
            />
            <button disabled={!conversation || conversation.status !== "ACTIVE" || !manualText.trim()} onClick={sendManualTranscript}>
              <Send size={18} /> Send Transcript
            </button>
          </section>

          <ConnectionStatus
            state={statusLabel}
            ack={lastAck}
            pendingCueJob={pendingCueJob}
            pendingSummaryJob={pendingSummaryJob}
          />
        </>
      ) : (
        <HistoryPanel
          history={history}
          activeId={activeHistory?.conversation.conversationId ?? ""}
          onOpen={openHistory}
        />
      )}

      <section className="content-grid">
        <TranscriptPanel chunks={displayedTranscript} />
        <CueList cues={displayedCues} />
        <SummaryPanel summary={displayedSummary} pending={pendingSummaryJob && view === "live"} />
      </section>

      <footer className="bottom-bar">
        <button onClick={() => setView("live")}>
          <MessageSquareText size={19} /> Live Conversation
        </button>
        <button onClick={() => setView("history")}>
          <History size={19} /> View History
        </button>
        <button onClick={clearSession}>
          <RotateCcw size={19} /> Reset
        </button>
      </footer>
    </main>
  );
}

function ConnectionStatus({
  state,
  ack,
  pendingCueJob,
  pendingSummaryJob,
}: {
  state: string;
  ack: TranscriptAckEvent | null;
  pendingCueJob: boolean;
  pendingSummaryJob: boolean;
}) {
  return (
    <section className="status-panel">
      <div>
        <p>Connection Status</p>
        <strong>{state}</strong>
      </div>
      <div>
        <p>Last Ack</p>
        <strong>{ack ? ack.chunkId : "-"}</strong>
      </div>
      <div>
        <p>Worker State</p>
        <strong>{pendingCueJob ? "Cue queued" : pendingSummaryJob ? "Summary queued" : "Ready"}</strong>
      </div>
    </section>
  );
}

function TranscriptPanel({ chunks }: { chunks: TranscriptChunk[] }) {
  return (
    <section className="panel transcript-panel">
      <header className="section-title">
        <h2>Transcript</h2>
        <span>{chunks.length}</span>
      </header>
      <div className="transcript-list">
        {chunks.length ? chunks.map((chunk) => (
          <article className="transcript-row" key={chunk.chunkId}>
            <time>{timeLabel(chunk.createdAt)}</time>
            <p>{chunk.text}</p>
          </article>
        )) : <p className="empty-state">No transcript yet.</p>}
      </div>
    </section>
  );
}

function CueList({ cues }: { cues: Cue[] }) {
  return (
    <section className="panel">
      <header className="section-title">
        <h2>AI Cues</h2>
        <span>{cues.length}</span>
      </header>
      <div className="cue-list">
        {cues.length ? cues.map((cue) => (
          <article className={`cue-card ${CUE_STYLE[cue.type]}`} key={cue.cueId}>
            <div className="cue-card-header">
              <span>{cue.type}</span>
              <time>{timeLabel(cue.createdAt)}</time>
            </div>
            <h3>{cue.title}</h3>
            <p>{cue.shortText}</p>
            <small>{cue.detailText}</small>
          </article>
        )) : <p className="empty-state">No AI cues yet.</p>}
      </div>
    </section>
  );
}

function SummaryPanel({ summary, pending }: { summary: ConversationSummary | null; pending: boolean }) {
  return (
    <section className="panel summary-panel">
      <header className="section-title">
        <h2>Conversation Summary</h2>
        <span>{pending ? "Pending" : summary ? "Ready" : "-"}</span>
      </header>
      {summary ? (
        <div className="summary-stack">
          <p className="summary-copy">{summary.summary}</p>
          <SummaryList title="Key Topics" items={summary.keyTopics} />
          <SummaryList title="Action Items" items={summary.actionItems} />
          <SummaryList title="Risks" items={summary.risks} />
        </div>
      ) : (
        <p className="empty-state">{pending ? "Summary generation is queued." : "No summary yet."}</p>
      )}
    </section>
  );
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="summary-list">
      <h3>{title}</h3>
      <ul>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

function HistoryPanel({
  history,
  activeId,
  onOpen,
}: {
  history: HistoryRecord[];
  activeId: string;
  onOpen: (record: HistoryRecord) => void;
}) {
  return (
    <section className="history-panel">
      <header className="section-title">
        <h2>Conversation History</h2>
        <span>{history.length}</span>
      </header>
      <div className="history-list">
        {history.length ? history.map((record) => (
          <button
            className={activeId === record.conversation.conversationId ? "history-row active" : "history-row"}
            key={record.conversation.conversationId}
            onClick={() => onOpen(record)}
          >
            <span>
              <strong>{dateLabel(record.conversation.startedAt)}</strong>
              <small>{record.transcript.length} transcript chunks · {record.cues.length} cues</small>
            </span>
            <em>{record.conversation.summaryStatus}</em>
          </button>
        )) : <p className="empty-state">No completed sessions yet.</p>}
      </div>
    </section>
  );
}
