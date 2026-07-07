import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  ClipboardCheck,
  Lightbulb,
  LockKeyhole,
  LogIn,
  LogOut,
  Mail,
  MoreHorizontal,
  Pause,
  Plus,
  Settings2,
  ShieldCheck,
  TriangleAlert,
  Trash2,
  UserPlus,
  UserRound,
  X,
} from "lucide-react";
import type {
  Conversation as CloudConversation,
  ConversationSummary as CloudConversationSummary,
  Cue as CloudCue,
  CueCreatedEvent,
  SummaryReadyEvent,
  TranscriptAckEvent,
  TranscriptChunk as CloudTranscriptChunk,
  WebSocketSendTranscriptMessage,
} from "@cueflow/shared";

type Screen = "home" | "settings" | "prenoteManager" | "prenoteDetail" | "live" | "history" | "conversationSettings";
type ConversationPage = "workspace" | "prenote";
type CueCategory = "concept" | "decision" | "risk" | "action" | "summary";
type LegacyCueCategory = "response" | "suggestion" | "person";
type SummaryStatus = "not_started" | "queued" | "running" | "ready" | "failed";
type SpeechLanguage = "english" | "chinese" | "auto";

type AiCue = {
  id: string;
  category: CueCategory;
  title: string;
  shortText: string;
  detailText: string;
  output: string;
  confidence?: number;
  sourceChunkStart?: string;
  sourceChunkEnd?: string;
  createdAt: string;
  source: "manual" | "auto";
};

type Prenote = {
  id: string;
  title: string;
  text: string;
  selected: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type PrenoteDraft = {
  title: string;
  text: string;
  selected?: boolean;
};

type TranscriptLine = {
  id: string;
  time: string;
  text: string;
  partial?: boolean;
};

type ConversationSummaryKeyPoint = {
  id: string;
  title: string;
  details: string[];
};

type ConversationSummaryActionItem = {
  id: string;
  text: string;
  checked: boolean;
};

type ConversationSummary = {
  status: SummaryStatus;
  title: string;
  overview: string;
  keyPoints: ConversationSummaryKeyPoint[];
  actionItems: ConversationSummaryActionItem[];
  emptyReason?: string;
  generatedAt?: string;
  error?: string;
};

type ConversationRecord = {
  id: string;
  title: string;
  startedAt: string;
  location: string;
  duration: string;
  summary: ConversationSummary;
  transcript: TranscriptLine[];
  cueHistory: AiCue[];
  usedPrenote?: Prenote;
};

type ConversationSettings = {
  language: SpeechLanguage;
  autoCue: boolean;
  cueDuration: 5000 | 10000 | 15000 | "forever";
};

type AiCueJson = {
  category?: CueCategory | LegacyCueCategory | "none";
  confidence?: number;
  title?: string;
  output?: string;
  reason?: string;
};

type AiSummaryJson = {
  title?: string;
  overview?: string;
  keyPoints?: Array<{
    title?: string;
    details?: string[];
  }>;
  actionItems?: Array<{
    text?: string;
  }> | string[];
};

type TranscriptionApiJson = {
  transcript?: string;
  text?: string;
  model?: string;
  language?: SpeechLanguage;
};

type RealtimeClientSecretJson = {
  clientSecret?: string;
  model?: string;
  delay?: string;
  language?: SpeechLanguage;
};

type PrenoteApiJson = {
  id?: string;
  title?: string;
  text?: string;
  selected?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type RuntimeConfig = {
  apiBase: string;
  webSocketUrl: string;
};

type ActiveConversationSnapshot = {
  conversationId: string;
  userId: string;
  startedAt: string;
  title: string;
};

type AuthUser = {
  name: string;
  email: string;
  role: string;
  signedInAt: string;
};

type LoginForm = {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
};

const TRANSCRIPT_FOLLOW_THRESHOLD_PX = 72;
const CUE_CATEGORY_ORDER: CueCategory[] = ["decision", "risk", "action", "concept", "summary"];
const AUTH_STORAGE_KEY = "cueflow.authUser";
const ACTIVE_CONVERSATION_STORAGE_KEY = "cueflow.activeConversation";
const REALTIME_VOICE_THRESHOLD = 0.012;
const REALTIME_TRANSCRIPT_SILENCE_MS = 1400;
const REALTIME_TRANSCRIPT_MIN_SPEECH_MS = 550;
const REALTIME_TRANSCRIPT_MAX_UTTERANCE_MS = 10000;
const REALTIME_FALLBACK_COMMIT_MS = 8000;
const CLOUD_STT_SEGMENT_MS = 4500;
const MIN_AUDIO_BLOB_BYTES = 1200;
const TRANSCRIPT_DUPLICATE_LOOKBACK = 4;
const CUE_TITLE_MAX_CHARS = 34;
const CUE_TITLE_MAX_WORDS = 5;
const CUE_SHORT_MAX_CHARS = 190;
const CUE_DETAIL_MAX_CHARS = 700;
const DEFAULT_AI_ENDPOINT = "/ai";
const DEFAULT_API_ENDPOINT = "";
const DEFAULT_DATA_ENDPOINT = "";

const DEFAULT_SETTINGS: ConversationSettings = {
  language: "english",
  autoCue: true,
  cueDuration: 10000,
};

const SAMPLE_PRENOTES: Prenote[] = [
  {
    id: "pn-architecture",
    title: "Architecture Brief",
    text: "Discuss CueFlow as a mobile-first cloud-native conversation intelligence platform. Cover WebSocket ingestion, async AI cue generation, DynamoDB metadata, and S3 transcript storage.",
    selected: true,
  },
  {
    id: "pn-rubric",
    title: "Course Rubric",
    text: "Be ready to explain cloud-native design, serverless trade-offs, monitoring, reliability, and cost controls.",
    selected: false,
  },
];

const SAMPLE_RECORDS: ConversationRecord[] = [
  {
    id: "record-cloud-review",
    title: "Cloud architecture review",
    startedAt: "Jun 28, 1:08 PM",
    location: "CueFlow demo",
    duration: "08:42",
    summary: {
      status: "ready",
      title: "Cloud architecture review",
      overview: "The session compared REST and WebSocket flows, separated transcript storage from AI work, and identified latency as the main operational risk.",
      keyPoints: [
        {
          id: "kp-1",
          title: "Real-time delivery",
          details: ["Use WebSocket for live transcript and cue updates.", "Keep REST for history and summary retrieval."],
        },
        {
          id: "kp-2",
          title: "Async processing",
          details: ["Queue cue generation so transcript ingestion does not wait for AI latency."],
        },
      ],
      actionItems: [
        { id: "act-1", text: "Deploy the mobile web client behind an HTTPS endpoint.", checked: true },
        { id: "act-2", text: "Explain why transcript chunks are persisted before AI processing.", checked: false },
      ],
      generatedAt: new Date().toISOString(),
    },
    transcript: [
      { id: "tr-1", time: "00:08", text: "We need CueFlow to feel like a real live conversation tool, not a manual demo form." },
      { id: "tr-2", time: "00:31", text: "The transcript should appear after entering a session and AI cues should come from the live context." },
      { id: "tr-3", time: "01:14", text: "The main cloud risk is AI latency if every chunk directly calls the model." },
    ],
    cueHistory: [
      {
        id: "cue-1",
        category: "concept",
        title: "Async cue pipeline",
        shortText: "Persist transcript chunks first, then enqueue context windows for AI cue generation.",
        detailText: "Persist transcript chunks first, then enqueue context windows for AI cue generation.",
        output: "Persist transcript chunks first, then enqueue context windows for AI cue generation.",
        confidence: 0.86,
        sourceChunkStart: "tr-1",
        sourceChunkEnd: "tr-3",
        createdAt: new Date().toISOString(),
        source: "auto",
      },
      {
        id: "cue-2",
        category: "action",
        title: "Demo talking point",
        shortText: "Show the live workspace with AI summary and transcript visible at the same time.",
        detailText: "Show the live workspace with AI summary and transcript visible at the same time.",
        output: "Show the live workspace with AI summary and transcript visible at the same time.",
        confidence: 0.82,
        sourceChunkStart: "tr-2",
        sourceChunkEnd: "tr-2",
        createdAt: new Date().toISOString(),
        source: "auto",
      },
    ],
    usedPrenote: SAMPLE_PRENOTES[0],
  },
];

function storedUser(): AuthUser | null {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthUser>;
    if (!parsed.email || !parsed.name) return null;
    return {
      name: parsed.name,
      email: parsed.email,
      role: parsed.role || "Student",
      signedInAt: parsed.signedInAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function persistUser(user: AuthUser | null) {
  try {
    if (user) window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // The demo still works if local storage is unavailable.
  }
}

function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] || "CueFlow User";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ") || "CueFlow User";
}

function userInitials(user: Pick<AuthUser, "name" | "email">): string {
  const source = user.name.trim() || user.email;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function canonicalTranscriptText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNearDuplicateTranscript(text: string, lines: TranscriptLine[]): boolean {
  const next = canonicalTranscriptText(text);
  if (!next) return true;
  return lines
    .filter((line) => !line.partial)
    .slice(-TRANSCRIPT_DUPLICATE_LOOKBACK)
    .some((line) => {
      const existing = canonicalTranscriptText(line.text);
      if (!existing) return false;
      if (existing === next) return true;
      const shorter = existing.length < next.length ? existing : next;
      const longer = existing.length < next.length ? next : existing;
      return longer.startsWith(shorter) && shorter.length / Math.max(longer.length, 1) >= 0.86;
    });
}

function selectedPrenote(prenotes: Prenote[]): Prenote | null {
  const selected = prenotes.filter((note) => note.selected);
  if (!selected.length) return null;
  if (selected.length === 1) return selected[0];
  return {
    id: "combined-prenote",
    title: "Selected Notes",
    text: selected.map((note) => `# ${note.title}\n${note.text}`).join("\n\n---\n\n"),
    selected: true,
  };
}

function formatClock(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatRecordDate(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function elapsedLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const rest = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}

function cueIcon(category: CueCategory) {
  if (category === "decision") return <Check size={21} strokeWidth={2} />;
  if (category === "risk") return <TriangleAlert size={21} strokeWidth={1.8} />;
  if (category === "action") return <ClipboardCheck size={21} strokeWidth={1.8} />;
  if (category === "summary") return <Lightbulb size={21} strokeWidth={1.8} />;
  return <BookOpen size={21} strokeWidth={1.7} />;
}

function cueLabel(category: CueCategory): string {
  if (category === "concept") return "Concept";
  if (category === "decision") return "Decision";
  if (category === "risk") return "Risk";
  if (category === "action") return "Action";
  return "Summary";
}

function cueCategoryFromCloudType(type: CloudCue["type"] | undefined): CueCategory {
  if (type === "DECISION") return "decision";
  if (type === "RISK") return "risk";
  if (type === "ACTION") return "action";
  if (type === "SUMMARY") return "summary";
  return "concept";
}

function normalizeCueCategory(category: AiCueJson["category"]): CueCategory | null {
  const normalized = String(category || "").trim().toLowerCase();
  if (!normalized || normalized === "none") return null;
  if (normalized === "decision" || normalized === "response") return "decision";
  if (normalized === "risk") return "risk";
  if (normalized === "action" || normalized === "suggestion") return "action";
  if (normalized === "summary") return "summary";
  if (normalized === "concept" || normalized === "person") return "concept";
  return null;
}

function formatCueConfidence(confidence: number | undefined): string | null {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
  return `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`;
}

function cueSourceLabel(cue: Pick<AiCue, "sourceChunkStart" | "sourceChunkEnd">): string | null {
  if (!cue.sourceChunkStart && !cue.sourceChunkEnd) return null;
  if (cue.sourceChunkStart && cue.sourceChunkStart === cue.sourceChunkEnd) return `Chunk ${cue.sourceChunkStart}`;
  return `Chunks ${cue.sourceChunkStart || "?"}-${cue.sourceChunkEnd || "?"}`;
}

function cueTimeLabel(createdAt: string): string | null {
  const created = dateFromIso(createdAt);
  if (!created) return null;
  return formatClock(created);
}

function cueMetaItems(cue: AiCue): string[] {
  return [
    formatCueConfidence(cue.confidence),
    cueSourceLabel(cue),
    cueTimeLabel(cue.createdAt),
  ].filter((item): item is string => Boolean(item));
}

function shouldAutoFollowTranscriptScroll(params: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
  thresholdPx?: number;
}): boolean {
  const threshold = params.thresholdPx ?? TRANSCRIPT_FOLLOW_THRESHOLD_PX;
  return params.scrollHeight - params.scrollTop - params.clientHeight <= threshold;
}

function groupCuesByCategory(cues: AiCue[]): Record<CueCategory, AiCue[]> {
  return {
    decision: cues.filter((cue) => cue.category === "decision"),
    risk: cues.filter((cue) => cue.category === "risk"),
    action: cues.filter((cue) => cue.category === "action"),
    concept: cues.filter((cue) => cue.category === "concept"),
    summary: cues.filter((cue) => cue.category === "summary"),
  };
}

function words(value: string): number {
  return value.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?/g)?.length ?? 0;
}

function cjkCharacters(value: string): number {
  return value.match(/[\u3400-\u9fff]/g)?.length ?? 0;
}

function meaningfulLength(value: string): number {
  return words(value) + Math.floor(cjkCharacters(value) / 2) + Math.floor(value.trim().length / 30);
}

function hasQuestionOrRequest(value: string): boolean {
  return /[?？]/.test(value)
    || /\b(what|why|how|should|can|could|would|explain|tell me|help|need|next)\b/i.test(value)
    || /(什么|为什么|怎么|如何|是否|可以|需要|应该|解释|下一步)/.test(value);
}

function promptContextFromPrenote(prenote: Prenote | null): string {
  if (!prenote) return "";
  return `Prepared context: ${prenote.title}\n${prenote.text}`.trim();
}

function hasReadableQuestionOrRequest(value: string): boolean {
  return /[?\uFF1F]/.test(value)
    || /\b(what|why|how|who|when|where|should|can|could|would|explain|tell me|help|need|next)\b/i.test(value)
    || /(\u4EC0\u4E48|\u4E3A\u4EC0\u4E48|\u600E\u4E48|\u5982\u4F55|\u662F\u5426|\u53EF\u4EE5|\u9700\u8981|\u5E94\u8BE5|\u89E3\u91CA|\u4E0B\u4E00\u6B65)/.test(value);
}

function shouldGenerateCue(lines: TranscriptLine[], cues: AiCue[], prenote: Prenote | null): boolean {
  const lastCue = cues[0];
  const recent = lastCue ? lines.slice(-3) : lines.slice(-2);
  const text = recent.map((line) => line.text).join(" ");
  const contextText = promptContextFromPrenote(prenote);
  return meaningfulLength(text) >= 12
    || Boolean(prenote && meaningfulLength(text) >= 5)
    || hasReadableQuestionOrRequest(text)
    || /\b(risk|should|decision|latency|cloud|api|next)\b/i.test(`${contextText}\n${text}`);
}

function configuredAiEndpoint(): string {
  return import.meta.env.VITE_CUEFLOW_AI_ENDPOINT?.trim() || DEFAULT_AI_ENDPOINT;
}

function initialRuntimeConfig(): RuntimeConfig {
  return {
    apiBase: import.meta.env.VITE_CUEFLOW_API_BASE?.trim() || DEFAULT_API_ENDPOINT,
    webSocketUrl: import.meta.env.VITE_CUEFLOW_WS_URL?.trim() || "",
  };
}

function configuredDataEndpoint(): string {
  return import.meta.env.VITE_CUEFLOW_DATA_ENDPOINT?.trim()
    || import.meta.env.VITE_CUEFLOW_API_BASE?.trim()
    || DEFAULT_DATA_ENDPOINT;
}

function dataUrl(path: string): string {
  const endpoint = configuredDataEndpoint().replace(/\/+$/, "");
  return `${endpoint}${path.startsWith("/") ? path : `/${path}`}`;
}

function apiUrl(path: string, runtimeConfig: RuntimeConfig): string {
  const endpoint = (
    import.meta.env.VITE_CUEFLOW_API_BASE?.trim()
    || runtimeConfig.apiBase.trim()
    || DEFAULT_API_ENDPOINT
  ).replace(/\/+$/, "");
  return `${endpoint}${path.startsWith("/") ? path : `/${path}`}`;
}

function webSocketUrlForConversation(runtimeConfig: RuntimeConfig, conversationId: string, user: AuthUser): string | null {
  const endpoint = import.meta.env.VITE_CUEFLOW_WS_URL?.trim() || runtimeConfig.webSocketUrl.trim();
  if (!endpoint) return null;
  try {
    const url = new URL(endpoint);
    url.searchParams.set("conversationId", conversationId);
    url.searchParams.set("userId", userIdForApi(user));
    return url.toString();
  } catch {
    return null;
  }
}

function userIdForApi(user: Pick<AuthUser, "email">): string {
  return user.email.trim().toLowerCase();
}

function activeConversationStorageKey(user: Pick<AuthUser, "email">): string {
  return `${ACTIVE_CONVERSATION_STORAGE_KEY}:${userIdForApi(user)}`;
}

function storedActiveConversation(user: Pick<AuthUser, "email">): ActiveConversationSnapshot | null {
  try {
    const raw = window.localStorage.getItem(activeConversationStorageKey(user));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveConversationSnapshot>;
    if (!parsed.conversationId || parsed.userId !== userIdForApi(user)) return null;
    return {
      conversationId: parsed.conversationId,
      userId: parsed.userId,
      startedAt: parsed.startedAt || new Date().toISOString(),
      title: parsed.title || "New conversation",
    };
  } catch {
    return null;
  }
}

function persistActiveConversation(user: Pick<AuthUser, "email">, snapshot: ActiveConversationSnapshot | null) {
  try {
    const key = activeConversationStorageKey(user);
    if (snapshot) window.localStorage.setItem(key, JSON.stringify(snapshot));
    else window.localStorage.removeItem(key);
  } catch {
    // Refresh recovery is best effort.
  }
}

function normalizePrenote(value: PrenoteApiJson): Prenote | null {
  const id = cleanOneLine(value.id, 140);
  const title = cleanOneLine(value.title, 160) || "Prepared Note";
  const text = cleanParagraph(value.text, 12000);
  if (!id) return null;
  return {
    id,
    title,
    text: text || title,
    selected: Boolean(value.selected),
    createdAt: cleanOneLine(value.createdAt, 80),
    updatedAt: cleanOneLine(value.updatedAt, 80),
  };
}

async function requestDataEndpoint<T>(
  path: string,
  user: AuthUser,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "x-cueflow-user-id": userIdForApi(user),
  };
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(dataUrl(path), {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) throw new Error(await endpointErrorMessage(response, "Prepared notes service"));
  return await responseJson<T>(response, "Prepared notes service");
}

async function listPrenotes(user: AuthUser): Promise<Prenote[]> {
  const data = await requestDataEndpoint<{ prenotes?: PrenoteApiJson[] }>("/prenotes", user);
  return (data.prenotes || []).map(normalizePrenote).filter((note): note is Prenote => Boolean(note));
}

async function createPrenoteApi(user: AuthUser, draft: Required<PrenoteDraft>): Promise<Prenote> {
  const data = await requestDataEndpoint<{ prenote?: PrenoteApiJson }>("/prenotes", user, {
    method: "POST",
    body: draft,
  });
  const prenote = normalizePrenote(data.prenote || {});
  if (!prenote) throw new Error("Prepared note response was invalid.");
  return prenote;
}

async function updatePrenoteApi(user: AuthUser, id: string, patch: Partial<Required<PrenoteDraft>>): Promise<Prenote> {
  const data = await requestDataEndpoint<{ prenote?: PrenoteApiJson }>(`/prenotes/${encodeURIComponent(id)}`, user, {
    method: "PUT",
    body: patch,
  });
  const prenote = normalizePrenote(data.prenote || {});
  if (!prenote) throw new Error("Prepared note response was invalid.");
  return prenote;
}

async function deletePrenoteApi(user: AuthUser, id: string): Promise<void> {
  await requestDataEndpoint<void>(`/prenotes/${encodeURIComponent(id)}`, user, { method: "DELETE" });
}

async function requestConversationApi<T>(
  path: string,
  user: AuthUser,
  runtimeConfig: RuntimeConfig,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "x-cueflow-user-id": userIdForApi(user),
  };
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(apiUrl(path, runtimeConfig), {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    throw new Error(await endpointErrorMessage(response, "Conversation service"));
  }
  return await responseJson<T>(response, "Conversation service");
}

async function createConversationApi(user: AuthUser, runtimeConfig: RuntimeConfig): Promise<CloudConversation> {
  const data = await requestConversationApi<{ conversation?: CloudConversation }>("/conversations", user, runtimeConfig, {
    method: "POST",
    body: {},
  });
  if (!data.conversation?.conversationId) throw new Error("Conversation response was invalid.");
  return data.conversation;
}

async function getConversationApi(user: AuthUser, runtimeConfig: RuntimeConfig, conversationId: string): Promise<CloudConversation> {
  const data = await requestConversationApi<{ conversation?: CloudConversation }>(
    `/conversations/${encodeURIComponent(conversationId)}`,
    user,
    runtimeConfig,
  );
  if (!data.conversation?.conversationId) throw new Error("Conversation response was invalid.");
  return data.conversation;
}

async function listConversationsApi(user: AuthUser, runtimeConfig: RuntimeConfig): Promise<CloudConversation[]> {
  const data = await requestConversationApi<{ conversations?: CloudConversation[] }>(
    `/conversations?userId=${encodeURIComponent(userIdForApi(user))}`,
    user,
    runtimeConfig,
  );
  return data.conversations || [];
}

async function getTranscriptApi(user: AuthUser, runtimeConfig: RuntimeConfig, conversationId: string): Promise<CloudTranscriptChunk[]> {
  const data = await requestConversationApi<{ transcript?: CloudTranscriptChunk[] }>(
    `/conversations/${encodeURIComponent(conversationId)}/transcript`,
    user,
    runtimeConfig,
  );
  return data.transcript || [];
}

async function getCuesApi(user: AuthUser, runtimeConfig: RuntimeConfig, conversationId: string): Promise<CloudCue[]> {
  const data = await requestConversationApi<{ cues?: CloudCue[] }>(
    `/conversations/${encodeURIComponent(conversationId)}/cues`,
    user,
    runtimeConfig,
  );
  return data.cues || [];
}

async function endConversationApi(
  user: AuthUser,
  runtimeConfig: RuntimeConfig,
  conversationId: string,
  promptContext?: string,
  usedPrenote?: Prenote | null,
): Promise<CloudConversation> {
  const data = await requestConversationApi<{ conversation?: CloudConversation }>(
    `/conversations/${encodeURIComponent(conversationId)}/end`,
    user,
    runtimeConfig,
    {
      method: "POST",
      body: {
        ...(promptContext ? { promptContext } : {}),
        ...(usedPrenote ? {
          usedPrenote: {
            id: usedPrenote.id,
            title: usedPrenote.title,
            text: usedPrenote.text,
          },
        } : {}),
      },
    },
  );
  if (!data.conversation?.conversationId) throw new Error("End conversation response was invalid.");
  return data.conversation;
}

async function getSummaryApi(user: AuthUser, runtimeConfig: RuntimeConfig, conversationId: string): Promise<CloudConversationSummary | null> {
  try {
    const data = await requestConversationApi<{ summary?: CloudConversationSummary }>(
      `/conversations/${encodeURIComponent(conversationId)}/summary`,
      user,
      runtimeConfig,
    );
  return data.summary || null;
  } catch {
    return null;
  }
}

function browserAudioLanguage(language: SpeechLanguage): string | undefined {
  if (language === "english") return "english";
  if (language === "chinese") return "chinese";
  return "auto";
}

async function blobToBase64(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Audio chunk could not be read."));
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.readAsDataURL(blob);
  });
}

async function transcribeAudioApi(
  user: AuthUser,
  runtimeConfig: RuntimeConfig,
  blob: Blob,
  settings: ConversationSettings,
  _prenote: Prenote | null,
): Promise<string> {
  const audioBase64 = await blobToBase64(blob);
  if (!audioBase64) return "";
  const data = await requestConversationApi<TranscriptionApiJson>("/transcribe", user, runtimeConfig, {
    method: "POST",
    body: {
      audioBase64,
      mimeType: blob.type || "audio/webm",
      language: browserAudioLanguage(settings.language),
    },
  });
  return cleanParagraph(data.transcript || data.text, 4000);
}

async function realtimeClientSecretApi(
  user: AuthUser,
  runtimeConfig: RuntimeConfig,
  settings: ConversationSettings,
): Promise<string> {
  const data = await requestConversationApi<RealtimeClientSecretJson>("/realtime/client-secret", user, runtimeConfig, {
    method: "POST",
    body: {
      language: settings.language,
    },
  });
  const clientSecret = cleanOneLine(data.clientSecret, 1200);
  if (!clientSecret) throw new Error("Realtime transcription session was invalid.");
  return clientSecret;
}

function transcriptText(lines: TranscriptLine[]): string {
  return lines.map((line) => `[${line.time}] ${line.text}`).join("\n").trim();
}

function cueHistoryText(cues: AiCue[]): string {
  return cues.map((cue) => `[${cue.category}] ${cue.title}: ${cue.output}`).join("\n").trim();
}

function cleanOneLine(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanParagraph(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

function fallbackCueTitle(category: CueCategory): string {
  if (category === "decision") return "Decision point";
  if (category === "risk") return "Risk";
  if (category === "action") return "Next step";
  if (category === "summary") return "Quick recap";
  return "Key concept";
}

function isCueTitleTooCloseToText(title: string, text: string): boolean {
  const titleKey = canonicalTranscriptText(title);
  const textKey = canonicalTranscriptText(text);
  if (!titleKey || !textKey) return false;
  if (titleKey === textKey) return true;
  if (textKey.startsWith(`${titleKey} `) && titleKey.length >= 18) return true;
  const shorter = titleKey.length < textKey.length ? titleKey : textKey;
  const longer = titleKey.length < textKey.length ? textKey : titleKey;
  return longer.startsWith(shorter) && shorter.length / Math.max(longer.length, 1) >= 0.82;
}

function compactCueTitle(rawTitle: unknown, category: CueCategory, shortText: string): string {
  const cleaned = cleanOneLine(rawTitle, 120).replace(/[.!?:;,]+$/g, "");
  if (!cleaned || isCueTitleTooCloseToText(cleaned, shortText)) {
    return fallbackCueTitle(category);
  }
  const words = cleaned.split(/\s+/).slice(0, CUE_TITLE_MAX_WORDS).join(" ");
  const clipped = words
    .slice(0, CUE_TITLE_MAX_CHARS)
    .replace(/[^\p{Letter}\p{Number}]+$/gu, "")
    .trim();
  return clipped || fallbackCueTitle(category);
}

function removeDuplicatedCueTitleLead(text: string, rawTitle: unknown): string {
  const cleanedText = text.trim();
  const cleanedTitle = cleanOneLine(rawTitle, 120).replace(/[.!?:;,]+$/g, "");
  if (!cleanedText || !cleanedTitle) return cleanedText;
  if (!cleanedText.toLowerCase().startsWith(cleanedTitle.toLowerCase())) return cleanedText;

  const rest = cleanedText.slice(cleanedTitle.length).replace(/^[\s:;,.!?-]+/, "").trim();
  return rest.length >= 18 ? rest : cleanedText;
}

async function endpointErrorMessage(response: Response, label: string): Promise<string> {
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  if (contentType.includes("application/json")) {
    try {
      const data = await response.json() as { error?: { message?: string }; message?: string };
      return data.error?.message || data.message || `${label} unavailable (${response.status}).`;
    } catch {
      return `${label} unavailable (${response.status}).`;
    }
  }
  return `${label} unavailable (${response.status}).`;
}

async function responseJson<T>(response: Response, label: string): Promise<T> {
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.includes("application/json")) {
    throw new Error(`${label} unavailable.`);
  }
  try {
    return await response.json() as T;
  } catch {
    throw new Error(`${label} returned invalid data.`);
  }
}

async function requestAiEndpoint<T>(path: "cue" | "summary", payload: unknown): Promise<T> {
  const endpoint = configuredAiEndpoint();
  const response = await fetch(`${endpoint.replace(/\/+$/, "")}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`AI endpoint failed (${response.status}).`);
  const data = await response.json() as Record<string, unknown>;
  return (data[path] ?? data.data ?? data) as T;
}

function buildCuePrompt(lines: TranscriptLine[], prenote: Prenote | null, settings: ConversationSettings): string {
  const recentTranscript = transcriptText(lines.slice(-8));
  const triggerWindow = transcriptText(lines.slice(-3));
  return [
    `Settings: language=${settings.language}; autoCue=${settings.autoCue ? "on" : "off"}`,
    prenote
      ? `Selected prenote, use only if directly relevant:\n${prenote.title}\n${prenote.text.trim().slice(0, 2500)}`
      : "",
    recentTranscript ? `Recent transcript:\n${recentTranscript.slice(-2200)}` : "",
    `Trigger window:\n${triggerWindow || "-"}`,
  ].filter(Boolean).join("\n\n");
}

function normalizeAiCue(value: AiCueJson): AiCue | null {
  const category = normalizeCueCategory(value.category);
  if (!category) return null;
  const rawOutput = cleanParagraph(value.output, CUE_DETAIL_MAX_CHARS);
  const title = compactCueTitle(value.title, category, rawOutput);
  const detailText = removeDuplicatedCueTitleLead(rawOutput, value.title);
  const shortText = cleanOneLine(removeDuplicatedCueTitleLead(rawOutput, value.title), CUE_SHORT_MAX_CHARS);
  if (!title || !detailText || !shortText) return null;
  const confidence = typeof value.confidence === "number" && Number.isFinite(value.confidence)
    ? Math.max(0, Math.min(1, value.confidence))
    : undefined;

  return {
    id: `cue-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    category,
    title,
    shortText,
    detailText,
    output: detailText,
    confidence,
    createdAt: new Date().toISOString(),
    source: "auto",
  };
}

async function requestAiCue(lines: TranscriptLine[], prenote: Prenote | null, settings: ConversationSettings): Promise<AiCue | null> {
  const prompt = buildCuePrompt(lines, prenote, settings);
  const payload = { prompt, transcript: transcriptText(lines), prenote, settings };
  const raw = await requestAiEndpoint<AiCueJson>("cue", payload);
  return normalizeAiCue(raw);
}

function buildSummaryPrompt(record: Pick<ConversationRecord, "title" | "transcript" | "cueHistory" | "usedPrenote">, language: SpeechLanguage): string {
  return [
    "You generate post-conversation summaries for CueFlow.",
    "",
    "Fact boundaries:",
    "- Transcript final lines are the primary facts. Summary claims must be grounded in transcript lines.",
    "- AI cue history is not conversation fact. It only shows what the assistant suggested during the conversation.",
    "- Prepared notes are background material. They may be useful context, but they were not necessarily discussed.",
    "- Do not claim cue history or prepared note content happened unless the transcript supports it.",
    "",
    'Return exactly one JSON object: { "title": "short conversation title", "overview": "one paragraph summary", "keyPoints": [{ "title": "short key point title", "details": ["supporting detail from transcript"] }], "actionItems": [{ "text": "concrete follow-up action if any" }] }',
    "",
    "Rules:",
    "- title: concise and specific.",
    "- overview: one useful paragraph.",
    "- keyPoints: group the main topics. Each detail should be grounded in transcript evidence.",
    "- actionItems: only include explicit or strongly implied follow-ups. Use [] if none.",
    `- Preferred language: ${language}.`,
    "",
    `Conversation title: ${record.title}`,
    "",
    "Transcript final lines:",
    transcriptText(record.transcript) || "-",
    "",
    cueHistoryText(record.cueHistory) ? `AI cue history, non-factual assistant suggestions:\n${cueHistoryText(record.cueHistory)}` : "AI cue history: none",
    "",
    record.usedPrenote?.text.trim() ? `Prepared note background, not conversation fact:\n${record.usedPrenote.title}\n${record.usedPrenote.text}` : "Prepared note background: none",
  ].join("\n");
}

function normalizeAiSummary(value: AiSummaryJson, fallbackTitle: string): ConversationSummary {
  const title = cleanOneLine(value.title, 120) || fallbackTitle;
  const overview = cleanParagraph(value.overview, 2200);
  if (!overview) throw new Error("Summary overview is required.");

  const keyPoints = Array.isArray(value.keyPoints) ? value.keyPoints : [];
  const actionItems = Array.isArray(value.actionItems) ? value.actionItems : [];

  return {
    status: "ready",
    title,
    overview,
    keyPoints: keyPoints
      .map((item, index) => ({
        id: `kp-${Date.now().toString(36)}-${index}`,
        title: cleanOneLine(item?.title, 140),
        details: Array.isArray(item?.details)
          ? item.details.map((detail) => cleanParagraph(detail, 600)).filter(Boolean).slice(0, 8)
          : [],
      }))
      .filter((item) => item.title)
      .slice(0, 12),
    actionItems: actionItems
      .map((item, index) => ({
        id: `act-${Date.now().toString(36)}-${index}`,
        text: typeof item === "string" ? cleanOneLine(item, 240) : cleanOneLine(item?.text, 240),
        checked: false,
      }))
      .filter((item) => item.text)
      .slice(0, 20),
    generatedAt: new Date().toISOString(),
  };
}

async function requestAiSummary(record: ConversationRecord, language: SpeechLanguage): Promise<ConversationSummary> {
  const transcript = transcriptText(record.transcript);
  if (!transcript) {
    return {
      status: "ready",
      title: record.title,
      overview: "This conversation was too short for a detailed AI summary.",
      keyPoints: [],
      actionItems: [],
      emptyReason: "too_short",
      generatedAt: new Date().toISOString(),
    };
  }

  const prompt = buildSummaryPrompt(record, language);
  const payload = { prompt, record, language };
  const raw = await requestAiEndpoint<AiSummaryJson>("summary", payload);
  return normalizeAiSummary(raw, record.title);
}

function queuedSummary(title: string, status: SummaryStatus = "queued", error?: string): ConversationSummary {
  return {
    status,
    title,
    overview: status === "failed" ? "AI summary generation failed." : "AI summary is being generated...",
    keyPoints: [],
    actionItems: [],
    error,
  };
}

function dateFromIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function durationFromConversation(conversation: CloudConversation): string {
  const started = dateFromIso(conversation.startedAt);
  const ended = dateFromIso(conversation.endedAt || undefined) ?? (conversation.status === "ACTIVE" ? new Date() : null);
  if (!started || !ended) return "00:00";
  return elapsedLabel(Math.max(0, Math.round((ended.getTime() - started.getTime()) / 1000)));
}

function cloudSummaryStatus(status: CloudConversation["summaryStatus"]): SummaryStatus {
  if (status === "PENDING") return "running";
  if (status === "READY") return "ready";
  if (status === "FAILED") return "failed";
  return "not_started";
}

function cloudCueToUi(cue: Partial<CloudCue> & { cueId?: string; type?: CloudCue["type"] }): AiCue | null {
  const id = cleanOneLine(cue.cueId, 140);
  const category = cueCategoryFromCloudType(cue.type);
  const rawShortText = cleanParagraph(cue.shortText, CUE_SHORT_MAX_CHARS);
  const rawDetailText = cleanParagraph(cue.detailText || cue.shortText, CUE_DETAIL_MAX_CHARS);
  const title = compactCueTitle(cue.title, category, rawShortText || rawDetailText);
  const shortText = cleanOneLine(removeDuplicatedCueTitleLead(rawShortText, cue.title), CUE_SHORT_MAX_CHARS);
  const detailText = cleanParagraph(removeDuplicatedCueTitleLead(rawDetailText, cue.title), CUE_DETAIL_MAX_CHARS);
  if (!id || !title || !shortText || !detailText) return null;
  const confidence = typeof cue.confidence === "number" && Number.isFinite(cue.confidence)
    ? Math.max(0, Math.min(1, cue.confidence))
    : undefined;
  return {
    id,
    category,
    title,
    shortText,
    detailText,
    output: detailText,
    confidence,
    sourceChunkStart: cleanOneLine(cue.sourceChunkStart, 80) || undefined,
    sourceChunkEnd: cleanOneLine(cue.sourceChunkEnd, 80) || undefined,
    createdAt: cleanOneLine(cue.createdAt, 80) || new Date().toISOString(),
    source: "auto",
  };
}

function transcriptLineFromChunk(chunk: CloudTranscriptChunk, conversation: CloudConversation, index: number): TranscriptLine {
  const started = dateFromIso(conversation.startedAt);
  const created = dateFromIso(chunk.createdAt);
  const seconds = started && created
    ? Math.max(0, Math.round((created.getTime() - started.getTime()) / 1000))
    : index;
  return {
    id: chunk.chunkId,
    time: elapsedLabel(seconds),
    text: chunk.text,
  };
}

function cloudSummaryToUi(summary: CloudConversationSummary, fallbackTitle: string): ConversationSummary {
  const keyPoints: ConversationSummaryKeyPoint[] = summary.keyTopics.map((topic, index) => ({
    id: `kp-${summary.conversationId}-${index}`,
    title: cleanOneLine(topic, 140),
    details: [],
  })).filter((point) => point.title);
  if (summary.risks.length) {
    keyPoints.push({
      id: `kp-${summary.conversationId}-risks`,
      title: "Risks",
      details: summary.risks.map((risk) => cleanParagraph(risk, 600)).filter(Boolean),
    });
  }
  return {
    status: "ready",
    title: fallbackTitle,
    overview: cleanParagraph(summary.summary, 2200) || "-",
    keyPoints,
    actionItems: summary.actionItems
      .map((item, index) => ({
        id: `act-${summary.conversationId}-${index}`,
        text: cleanOneLine(item, 240),
        checked: false,
      }))
      .filter((item) => item.text),
    generatedAt: summary.createdAt,
  };
}

function titleFromCloudConversation(
  conversation: CloudConversation,
  transcript: TranscriptLine[],
  summary: CloudConversationSummary | null,
): string {
  const fromTranscript = cleanOneLine(transcript[0]?.text, 52);
  if (fromTranscript) return fromTranscript;
  const fromSummary = cleanOneLine(summary?.summary, 52);
  if (fromSummary) return fromSummary;
  const started = dateFromIso(conversation.startedAt);
  return started ? `Conversation ${formatRecordDate(started)}` : "Conversation";
}

function usedPrenoteFromCloud(conversation: CloudConversation): Prenote | undefined {
  const note = conversation.usedPrenote;
  if (!note?.title && !note?.text) return undefined;
  return {
    id: cleanOneLine(note.id, 140) || "used-prenote",
    title: cleanOneLine(note.title, 160) || "Prepared Note",
    text: cleanParagraph(note.text, 12000) || cleanOneLine(note.title, 160) || "Prepared Note",
    selected: true,
  };
}

async function cloudConversationToRecord(
  user: AuthUser,
  runtimeConfig: RuntimeConfig,
  conversation: CloudConversation,
): Promise<ConversationRecord> {
  const [transcriptResult, cuesResult, summaryResult] = await Promise.allSettled([
    getTranscriptApi(user, runtimeConfig, conversation.conversationId),
    getCuesApi(user, runtimeConfig, conversation.conversationId),
    conversation.summaryStatus === "READY"
      ? getSummaryApi(user, runtimeConfig, conversation.conversationId)
      : Promise.resolve(null),
  ]);
  const chunks = transcriptResult.status === "fulfilled" ? transcriptResult.value : [];
  const cloudCues = cuesResult.status === "fulfilled" ? cuesResult.value : [];
  const cloudSummary = summaryResult.status === "fulfilled" ? summaryResult.value : null;
  const transcript = chunks.map((chunk, index) => transcriptLineFromChunk(chunk, conversation, index));
  const cueHistory = cloudCues.map(cloudCueToUi).filter((cue): cue is AiCue => Boolean(cue));
  const title = titleFromCloudConversation(conversation, transcript, cloudSummary);
  const started = dateFromIso(conversation.startedAt);
  return {
    id: conversation.conversationId,
    title,
    startedAt: started ? formatRecordDate(started) : conversation.startedAt,
    location: "CueFlow",
    duration: durationFromConversation(conversation),
    summary: cloudSummary
      ? cloudSummaryToUi(cloudSummary, title)
      : queuedSummary(title, cloudSummaryStatus(conversation.summaryStatus)),
    transcript,
    cueHistory,
    usedPrenote: usedPrenoteFromCloud(conversation),
  };
}

export default function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => storedUser());
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig>(() => initialRuntimeConfig());
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [loginForm, setLoginForm] = useState<LoginForm>({
    name: "",
    email: "student@cueflow.dev",
    password: "",
    confirmPassword: "",
  });
  const [loginError, setLoginError] = useState("");
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [accountDraft, setAccountDraft] = useState({ name: "", email: "" });
  const [screen, setScreen] = useState<Screen>("home");
  const [livePage, setLivePage] = useState<ConversationPage>("workspace");
  const [historyPage, setHistoryPage] = useState<ConversationPage>("workspace");
  const [settings, setSettings] = useState<ConversationSettings>(DEFAULT_SETTINGS);
  const [records, setRecords] = useState<ConversationRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState("");
  const [prenotes, setPrenotes] = useState<Prenote[]>([]);
  const [prenotesLoading, setPrenotesLoading] = useState(false);
  const [prenotesError, setPrenotesError] = useState("");
  const [activePrenoteId, setActivePrenoteId] = useState<string | null>(null);
  const [prenoteDetailDraft, setPrenoteDetailDraft] = useState<Required<PrenoteDraft>>({ title: "", text: "", selected: true });
  const [isSavingPrenote, setIsSavingPrenote] = useState(false);
  const [cues, setCues] = useState<AiCue[]>([]);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [activeRecordId, setActiveRecordId] = useState<string>("");
  const [isListening, setIsListening] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState("ready");
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeStartedAt, setActiveStartedAt] = useState<Date | null>(null);
  const [activeRecordTitle, setActiveRecordTitle] = useState("New conversation");
  const [isStartingConversation, setIsStartingConversation] = useState(false);
  const [isEndingConversation, setIsEndingConversation] = useState(false);
  const [swipedRecordId, setSwipedRecordId] = useState<string | null>(null);
  const [swipedPrenoteId, setSwipedPrenoteId] = useState<string | null>(null);
  const [selectedCueDetail, setSelectedCueDetail] = useState<AiCue | null>(null);

  const activePrenote = useMemo(() => selectedPrenote(prenotes), [prenotes]);
  const activeRecord = records.find((record) => record.id === activeRecordId) || records[0] || null;
  const totalRecordMinutes = records.reduce((total, record) => {
    const [minutes = "0", seconds = "0"] = record.duration.split(":");
    return total + Number(minutes) + Number(seconds) / 60;
  }, 0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const realtimePeerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const realtimeDataChannelRef = useRef<RTCDataChannel | null>(null);
  const realtimeTranscriptDraftsRef = useRef<Record<string, string>>({});
  const realtimeAudioContextRef = useRef<AudioContext | null>(null);
  const realtimeVadFrameRef = useRef<number | null>(null);
  const realtimeSpeechStartedAtRef = useRef<number | null>(null);
  const realtimeLastVoiceAtRef = useRef<number | null>(null);
  const realtimeCommitPendingRef = useRef(false);
  const realtimeFallbackCommitTimerRef = useRef<number | null>(null);
  const recorderStopResolversRef = useRef<Array<() => void>>([]);
  const transcriptionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const webSocketRef = useRef<WebSocket | null>(null);
  const shouldListenRef = useRef(false);
  const restoringActiveConversationRef = useRef(false);
  const activeConversationIdRef = useRef<string | null>(null);
  const runtimeConfigRef = useRef<RuntimeConfig>(runtimeConfig);
  const transcriptRef = useRef<TranscriptLine[]>([]);
  const cuesRef = useRef<AiCue[]>([]);
  const elapsedSecondsRef = useRef(0);
  const settingsRef = useRef<ConversationSettings>(settings);
  const activePrenoteRef = useRef<Prenote | null>(activePrenote);
  const cueTimerRef = useRef<number | null>(null);
  const cueInFlightRef = useRef(false);
  const recordPointerRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const skipNextRecordClickRef = useRef(false);
  const prenotePointerRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const skipNextPrenoteClickRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/runtime-config.json", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return await response.json() as Partial<RuntimeConfig>;
      })
      .then((config) => {
        if (!config || cancelled) return;
        setRuntimeConfig((current) => ({
          apiBase: import.meta.env.VITE_CUEFLOW_API_BASE?.trim() || cleanOneLine(config.apiBase, 500) || current.apiBase,
          webSocketUrl: import.meta.env.VITE_CUEFLOW_WS_URL?.trim() || cleanOneLine(config.webSocketUrl, 500) || current.webSocketUrl,
        }));
      })
      .catch(() => {
        // Local dev can run without a runtime config endpoint.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    runtimeConfigRef.current = runtimeConfig;
  }, [runtimeConfig]);

  useEffect(() => {
    elapsedSecondsRef.current = elapsedSeconds;
  }, [elapsedSeconds]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    activePrenoteRef.current = activePrenote;
  }, [activePrenote]);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    cuesRef.current = cues;
  }, [cues]);

  useEffect(() => {
    if (!isListening) return;
    const interval = window.setInterval(() => setElapsedSeconds((current) => current + 1), 1000);
    return () => window.clearInterval(interval);
  }, [isListening]);

  useEffect(() => {
    if (!authUser) return;
    setAccountDraft({
      name: authUser.name,
      email: authUser.email,
    });
  }, [authUser]);

  useEffect(() => {
    if (!authUser) {
      setRecords([]);
      setRecordsError("");
      setRecordsLoading(false);
      return;
    }

    let cancelled = false;
    async function load() {
      if (!authUser) return;
      setRecordsLoading(true);
      setRecordsError("");
      try {
        const conversations = await listConversationsApi(authUser, runtimeConfigRef.current);
        const cloudRecords = await Promise.all(conversations.map((conversation) => (
          cloudConversationToRecord(authUser, runtimeConfigRef.current, conversation)
        )));
        if (!cancelled) {
          setRecords(cloudRecords);
          if (!activeRecordId && cloudRecords[0]) setActiveRecordId(cloudRecords[0].id);
        }
      } catch (error) {
        if (!cancelled) setRecordsError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setRecordsLoading(false);
      }
    }

    void load();
    const refresh = window.setInterval(() => {
      if (!activeConversationIdRef.current) void load();
    }, 12000);
    return () => {
      cancelled = true;
      window.clearInterval(refresh);
    };
  }, [authUser?.email, runtimeConfig.apiBase]);

  useEffect(() => {
    if (!authUser) {
      setPrenotes([]);
      setPrenotesError("");
      setPrenotesLoading(false);
      return;
    }

    let cancelled = false;
    setPrenotesLoading(true);
    setPrenotesError("");
    void listPrenotes(authUser)
      .then((items) => {
        if (!cancelled) setPrenotes(items);
      })
      .catch((error) => {
        if (!cancelled) setPrenotesError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setPrenotesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authUser?.email]);

  useEffect(() => {
    if (!authUser || activeConversationIdRef.current || restoringActiveConversationRef.current) return;
    const saved = storedActiveConversation(authUser);
    if (!saved) return;

    let cancelled = false;
    restoringActiveConversationRef.current = true;
    setConnectionStatus("restoring session");
    void (async () => {
      try {
        const conversation = await getConversationApi(authUser, runtimeConfigRef.current, saved.conversationId);
        if (cancelled) return;
        if (conversation.status !== "ACTIVE") {
          persistActiveConversation(authUser, null);
          return;
        }

        const [chunks, cloudCues] = await Promise.all([
          getTranscriptApi(authUser, runtimeConfigRef.current, conversation.conversationId),
          getCuesApi(authUser, runtimeConfigRef.current, conversation.conversationId),
        ]);
        if (cancelled) return;

        const startedAt = dateFromIso(conversation.startedAt) ?? dateFromIso(saved.startedAt) ?? new Date();
        const restoredTranscript = chunks.map((chunk, index) => transcriptLineFromChunk(chunk, conversation, index));
        const restoredCues = cloudCues
          .map(cloudCueToUi)
          .filter((cue): cue is AiCue => Boolean(cue))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        setActiveConversationId(conversation.conversationId);
        activeConversationIdRef.current = conversation.conversationId;
        setActiveStartedAt(startedAt);
        setActiveRecordTitle(saved.title || titleFromCloudConversation(conversation, restoredTranscript, null));
        const elapsed = Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1000));
        setElapsedSeconds(elapsed);
        elapsedSecondsRef.current = elapsed;
        setTranscript(restoredTranscript);
        transcriptRef.current = restoredTranscript;
        setCues(restoredCues);
        cuesRef.current = restoredCues;
        setIsListening(false);
        shouldListenRef.current = false;
        setLivePage("workspace");
        setScreen("live");
        await connectConversationSocket(conversation);
        if (!cancelled) setConnectionStatus("paused");
      } catch (error) {
        if (!cancelled) {
          setConnectionStatus("restore failed");
          setRecordsError(error instanceof Error ? error.message : String(error));
          persistActiveConversation(authUser, null);
        }
      } finally {
        restoringActiveConversationRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
      restoringActiveConversationRef.current = false;
    };
  }, [authUser?.email, runtimeConfig.apiBase, runtimeConfig.webSocketUrl]);

  useEffect(() => () => {
    shouldListenRef.current = false;
    void stopRealtimeTranscription();
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    } catch {
      // Ignore recorder shutdown races during page unload.
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    webSocketRef.current?.close();
    if (cueTimerRef.current) window.clearTimeout(cueTimerRef.current);
  }, []);

  function sendRealtimeCommit(dataChannel: RTCDataChannel | null) {
    if (!dataChannel || dataChannel.readyState !== "open") return;
    try {
      dataChannel.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    } catch {
      // The channel can close while the microphone is being released.
    }
  }

  function stopRealtimeVad() {
    if (realtimeVadFrameRef.current !== null) {
      window.cancelAnimationFrame(realtimeVadFrameRef.current);
      realtimeVadFrameRef.current = null;
    }
    if (realtimeFallbackCommitTimerRef.current !== null) {
      window.clearInterval(realtimeFallbackCommitTimerRef.current);
      realtimeFallbackCommitTimerRef.current = null;
    }
    const audioContext = realtimeAudioContextRef.current;
    realtimeAudioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close().catch(() => undefined);
    }
    realtimeSpeechStartedAtRef.current = null;
    realtimeLastVoiceAtRef.current = null;
    realtimeCommitPendingRef.current = false;
  }

  function startRealtimeCommitFallback() {
    if (realtimeFallbackCommitTimerRef.current !== null) return;
    realtimeSpeechStartedAtRef.current = Date.now();
    realtimeLastVoiceAtRef.current = Date.now();
    realtimeFallbackCommitTimerRef.current = window.setInterval(() => {
      if (!shouldListenRef.current) return;
      realtimeSpeechStartedAtRef.current ||= Date.now();
      realtimeLastVoiceAtRef.current ||= Date.now();
      commitRealtimeUtterance("max");
    }, REALTIME_FALLBACK_COMMIT_MS);
  }

  function commitRealtimeUtterance(reason: "silence" | "max" | "stop") {
    const speechStartedAt = realtimeSpeechStartedAtRef.current;
    const dataChannel = realtimeDataChannelRef.current;
    if (!speechStartedAt || !dataChannel || dataChannel.readyState !== "open" || realtimeCommitPendingRef.current) return;
    realtimeCommitPendingRef.current = true;
    sendRealtimeCommit(dataChannel);
    realtimeSpeechStartedAtRef.current = null;
    realtimeLastVoiceAtRef.current = null;
    setConnectionStatus(reason === "stop" ? "finalizing transcript" : "realtime finalizing");
    window.setTimeout(() => {
      realtimeCommitPendingRef.current = false;
    }, 500);
  }

  function startRealtimeVad(stream: MediaStream) {
    stopRealtimeVad();
    const AudioContextCtor = window.AudioContext
      || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      startRealtimeCommitFallback();
      return;
    }

    try {
      const audioContext = new AudioContextCtor();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      realtimeAudioContextRef.current = audioContext;
      if (audioContext.state === "suspended") {
        void audioContext.resume().catch(() => undefined);
      }
      const data = new Uint8Array(analyser.fftSize);

      const tick = () => {
        if (!shouldListenRef.current) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const sample of data) {
          const normalized = (sample - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / data.length);
        const now = Date.now();

        if (rms >= REALTIME_VOICE_THRESHOLD) {
          if (!realtimeSpeechStartedAtRef.current) {
            realtimeSpeechStartedAtRef.current = now;
            setConnectionStatus("realtime hearing speech");
          }
          realtimeLastVoiceAtRef.current = now;
        }

        const startedAt = realtimeSpeechStartedAtRef.current;
        const lastVoiceAt = realtimeLastVoiceAtRef.current;
        const dataChannelOpen = realtimeDataChannelRef.current?.readyState === "open";
        if (startedAt && lastVoiceAt && dataChannelOpen && !realtimeCommitPendingRef.current) {
          const speechMs = now - startedAt;
          const silenceMs = now - lastVoiceAt;
          if (speechMs >= REALTIME_TRANSCRIPT_MAX_UTTERANCE_MS) {
            commitRealtimeUtterance("max");
          } else if (speechMs >= REALTIME_TRANSCRIPT_MIN_SPEECH_MS && silenceMs >= REALTIME_TRANSCRIPT_SILENCE_MS) {
            commitRealtimeUtterance("silence");
          }
        }

        realtimeVadFrameRef.current = window.requestAnimationFrame(tick);
      };

      realtimeVadFrameRef.current = window.requestAnimationFrame(tick);
    } catch {
      setConnectionStatus("realtime vad unavailable");
      startRealtimeCommitFallback();
    }
  }

  async function stopRealtimeTranscription(finalize = false) {
    const dataChannel = realtimeDataChannelRef.current;
    if (finalize) {
      commitRealtimeUtterance("stop");
      await new Promise((resolve) => window.setTimeout(resolve, 650));
    }
    stopRealtimeVad();
    try {
      dataChannel?.close();
    } catch {
      // Ignore WebRTC shutdown races.
    }
    try {
      realtimePeerConnectionRef.current?.close();
    } catch {
      // Ignore WebRTC shutdown races.
    }
    realtimeDataChannelRef.current = null;
    realtimePeerConnectionRef.current = null;
    realtimeTranscriptDraftsRef.current = {};
  }

  function preferredAudioMimeType(): string {
    if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
    return [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ].find((type) => MediaRecorder.isTypeSupported(type)) || "";
  }

  function queueAudioTranscription(blob: Blob) {
    const userSnapshot = authUser;
    const conversationId = activeConversationIdRef.current;
    if (!userSnapshot || !conversationId) return;
    if (blob.size < MIN_AUDIO_BLOB_BYTES) {
      setConnectionStatus(shouldListenRef.current ? "cloud stt listening" : "paused");
      return;
    }
    const runtimeSnapshot = runtimeConfigRef.current;
    const settingsSnapshot = settingsRef.current;
    const prenoteSnapshot = activePrenoteRef.current;

    transcriptionQueueRef.current = transcriptionQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (activeConversationIdRef.current !== conversationId) return;
        setConnectionStatus("transcribing");
        const text = await transcribeAudioApi(userSnapshot, runtimeSnapshot, blob, settingsSnapshot, prenoteSnapshot);
        if (activeConversationIdRef.current !== conversationId) return;
        if (text) {
          appendTranscript(text);
        } else {
          setConnectionStatus(shouldListenRef.current ? "cloud stt listening" : "paused");
        }
      })
      .catch((error) => {
        if (activeConversationIdRef.current === conversationId) {
          const message = error instanceof Error ? error.message : "transcription failed";
          if (message.includes("Payload") || message.includes("too large")) {
            setConnectionStatus("audio too large");
          } else {
            setConnectionStatus(shouldListenRef.current ? "cloud stt listening" : "transcription failed");
          }
        }
      });
  }

  function handleRealtimeTranscriptionEvent(payload: Record<string, unknown>) {
    const type = cleanOneLine(payload.type, 120);
    if (type === "conversation.item.input_audio_transcription.delta") {
      const itemId = cleanOneLine(payload.item_id, 120) || "realtime";
      const delta = typeof payload.delta === "string" ? payload.delta : "";
      if (!delta) return;
      const next = `${realtimeTranscriptDraftsRef.current[itemId] || ""}${delta}`;
      realtimeTranscriptDraftsRef.current[itemId] = next;
      upsertPartialTranscript(next, itemId);
      setConnectionStatus("realtime transcribing");
      return;
    }

    if (type === "conversation.item.input_audio_transcription.completed") {
      const itemId = cleanOneLine(payload.item_id, 120) || "realtime";
      delete realtimeTranscriptDraftsRef.current[itemId];
      const text = cleanParagraph(payload.transcript, 4000);
      if (text) appendTranscript(text);
      setConnectionStatus("realtime listening");
      return;
    }

    if (type === "conversation.item.input_audio_transcription.failed" || type === "error") {
      setConnectionStatus("realtime stt error");
    }
  }

  async function startRealtimeTranscription(): Promise<boolean> {
    const userSnapshot = authUser;
    if (!userSnapshot) return false;
    if (!window.isSecureContext) {
      setConnectionStatus("microphone requires https");
      return false;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
      setConnectionStatus("realtime stt unavailable");
      return false;
    }
    if (realtimePeerConnectionRef.current) {
      setConnectionStatus("realtime listening");
      return true;
    }

    let stream: MediaStream | null = null;
    try {
      setConnectionStatus("connecting realtime stt");
      const clientSecret = await realtimeClientSecretApi(userSnapshot, runtimeConfigRef.current, settingsRef.current);
      const peer = new RTCPeerConnection();
      const dataChannel = peer.createDataChannel("oai-events");
      realtimePeerConnectionRef.current = peer;
      realtimeDataChannelRef.current = dataChannel;

      dataChannel.onopen = () => setConnectionStatus("realtime listening");
      dataChannel.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as Record<string, unknown>;
          handleRealtimeTranscriptionEvent(payload);
        } catch {
          // Ignore malformed provider events.
        }
      };
      dataChannel.onerror = () => setConnectionStatus("realtime stt error");

      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected") setConnectionStatus("realtime listening");
        if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
          setConnectionStatus("realtime stt disconnected");
        }
      };

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;
      startRealtimeVad(stream);
      for (const track of stream.getAudioTracks()) {
        peer.addTrack(track, stream);
      }

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp || "",
        headers: {
          authorization: `Bearer ${clientSecret}`,
          "content-type": "application/sdp",
        },
      });
      if (!sdpResponse.ok) {
        throw new Error(`Realtime SDP failed (${sdpResponse.status}).`);
      }
      await peer.setRemoteDescription({
        type: "answer",
        sdp: await sdpResponse.text(),
      });
      setConnectionStatus("realtime listening");
      return true;
    } catch {
      void stopRealtimeTranscription();
      stream?.getTracks().forEach((track) => track.stop());
      if (mediaStreamRef.current === stream) mediaStreamRef.current = null;
      setConnectionStatus("realtime stt unavailable");
      return false;
    }
  }

  function startRecordingSegment(stream: MediaStream): boolean {
    if (!shouldListenRef.current || !activeConversationIdRef.current) return false;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") return true;

    try {
      const mimeType = preferredAudioMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.onstart = () => {
        setConnectionStatus("cloud stt recording");
      };
      recorder.ondataavailable = (event) => {
        if (!event.data?.size) return;
        const type = recorder.mimeType || event.data.type || mimeType || "audio/webm";
        queueAudioTranscription(new Blob([event.data], { type }));
      };
      recorder.onerror = () => {
        setConnectionStatus("cloud stt error");
      };
      recorder.onstop = () => {
        if (mediaRecorderRef.current === recorder) mediaRecorderRef.current = null;
        const resolvers = recorderStopResolversRef.current.splice(0);
        resolvers.forEach((resolve) => resolve());
      };

      recorder.start(CLOUD_STT_SEGMENT_MS);
      setConnectionStatus("cloud stt recording");
      return true;
    } catch {
      setConnectionStatus("cloud stt unavailable");
      return false;
    }
  }

  async function startCloudTranscription(): Promise<boolean> {
    if (!window.isSecureContext) {
      setConnectionStatus("microphone requires https");
      return false;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      return false;
    }
    if (mediaRecorderRef.current?.state === "recording") {
      shouldListenRef.current = true;
      setConnectionStatus("cloud stt listening");
      return true;
    }
    if (mediaStreamRef.current) {
      shouldListenRef.current = true;
      return startRecordingSegment(mediaStreamRef.current);
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;
      shouldListenRef.current = true;
      setConnectionStatus("connecting cloud stt");
      return startRecordingSegment(stream);
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      setConnectionStatus(name === "NotAllowedError" || name === "SecurityError" ? "microphone blocked" : "cloud stt unavailable");
      return false;
    }
  }

  async function startRecognition(): Promise<boolean> {
    shouldListenRef.current = true;
    setConnectionStatus("connecting realtime stt");
    const realtimeStarted = await startRealtimeTranscription();
    if (realtimeStarted) {
      setConnectionStatus("realtime listening");
      return true;
    }
    setConnectionStatus("cloud stt fallback");
    const cloudStarted = await startCloudTranscription();
    if (cloudStarted) {
      setConnectionStatus("cloud stt listening");
      return true;
    }
    setConnectionStatus("cloud stt unavailable");
    return false;
  }

  function stopRecognition(nextStatus = "paused"): Promise<void> {
    shouldListenRef.current = false;
    const realtimeStopped = stopRealtimeTranscription(true);
    const recorder = mediaRecorderRef.current;
    let recorderStopped: Promise<void> = Promise.resolve();
    if (recorder && recorder.state !== "inactive") {
      recorderStopped = new Promise((resolve) => {
        let resolved = false;
        const finish = () => {
          if (resolved) return;
          resolved = true;
          resolve();
        };
        recorderStopResolversRef.current.push(finish);
        window.setTimeout(finish, 1200);
      });
      try {
        recorder.requestData();
        recorder.stop();
      } catch {
        // The stream cleanup below still releases the microphone.
        mediaRecorderRef.current = null;
        const resolvers = recorderStopResolversRef.current.splice(0);
        resolvers.forEach((resolve) => resolve());
      }
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    setConnectionStatus(nextStatus);
    return Promise.all([recorderStopped, realtimeStopped]).then(() => undefined);
  }

  async function refreshRecords(preferredRecordId?: string) {
    if (!authUser) return;
    setRecordsLoading(true);
    setRecordsError("");
    try {
      const conversations = await listConversationsApi(authUser, runtimeConfigRef.current);
      const cloudRecords = await Promise.all(conversations.map((conversation) => (
        cloudConversationToRecord(authUser, runtimeConfigRef.current, conversation)
      )));
      setRecords(cloudRecords);
      const targetId = preferredRecordId
        ?? (activeRecordId && cloudRecords.some((record) => record.id === activeRecordId) ? activeRecordId : cloudRecords[0]?.id);
      if (targetId) setActiveRecordId(targetId);
    } catch (error) {
      setRecordsError(error instanceof Error ? error.message : String(error));
    } finally {
      setRecordsLoading(false);
    }
  }

  function handleWebSocketMessage(event: MessageEvent<string>, conversationId: string) {
    try {
      const payload = JSON.parse(event.data) as Partial<TranscriptAckEvent | CueCreatedEvent | SummaryReadyEvent>;
      if (payload.conversationId && payload.conversationId !== conversationId) return;

      if (payload.eventType === "transcript.ack") {
        setConnectionStatus(shouldListenRef.current ? "listening" : "paused");
        return;
      }

      if (payload.eventType === "cue.created") {
        const cuePayload = (payload as CueCreatedEvent).cue;
        const cue = cloudCueToUi({
          cueId: cuePayload.cueId,
          type: cuePayload.type,
          title: cuePayload.title,
          shortText: cuePayload.shortText,
          detailText: cuePayload.detailText,
          sourceChunkStart: cuePayload.sourceChunkStart,
          sourceChunkEnd: cuePayload.sourceChunkEnd,
          confidence: cuePayload.confidence,
          createdAt: cuePayload.createdAt,
        });
        if (!cue) return;
        setCues((current) => {
          const next = [cue, ...current.filter((item) => item.id !== cue.id)].slice(0, 20);
          cuesRef.current = next;
          return next;
        });
        setConnectionStatus(shouldListenRef.current ? "listening" : "ai cue ready");
        return;
      }

      if (payload.eventType === "summary.ready") {
        setConnectionStatus("summary ready");
        void refreshRecords(payload.conversationId);
      }
    } catch {
      // Ignore malformed socket payloads from retries or test tools.
    }
  }

  function connectConversationSocket(conversation: CloudConversation): Promise<boolean> {
    if (!authUser) return Promise.resolve(false);
    const url = webSocketUrlForConversation(runtimeConfigRef.current, conversation.conversationId, authUser);
    if (!url) {
      setConnectionStatus("cloud socket unavailable");
      return Promise.resolve(false);
    }

    webSocketRef.current?.close();
    setConnectionStatus("connecting cloud");

    return new Promise((resolve) => {
      const socket = new WebSocket(url);
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        setConnectionStatus("cloud socket timeout");
        socket.close();
        resolve(false);
      }, 7000);

      socket.onopen = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        webSocketRef.current = socket;
        setConnectionStatus("cloud connected");
        resolve(true);
      };

      socket.onmessage = (event) => handleWebSocketMessage(event, conversation.conversationId);

      socket.onerror = () => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          setConnectionStatus("cloud socket failed");
          resolve(false);
        }
      };

      socket.onclose = () => {
        if (webSocketRef.current === socket) webSocketRef.current = null;
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          resolve(false);
        }
        if (activeConversationIdRef.current === conversation.conversationId && shouldListenRef.current) {
          setConnectionStatus("cloud socket closed");
        }
      };
    });
  }

  function sendTranscriptChunk(line: TranscriptLine, conversationId: string, prenote: Prenote | null) {
    const socket = webSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setConnectionStatus("cloud socket unavailable");
      if (settingsRef.current.autoCue && shouldGenerateCue(transcriptRef.current, cuesRef.current, prenote)) {
        void generateCueForTranscript(transcriptRef.current.slice(-8), prenote, settingsRef.current);
      }
      return;
    }

    const message: WebSocketSendTranscriptMessage = {
      action: "sendTranscript",
      conversationId,
      chunkId: line.id.replace(/^line-/, "chunk-"),
      speaker: "speaker",
      text: line.text,
      clientTimestamp: new Date().toISOString(),
      autoCue: settingsRef.current.autoCue,
      ...(promptContextFromPrenote(prenote) ? { promptContext: promptContextFromPrenote(prenote) } : {}),
    };
    socket.send(JSON.stringify(message));
    setConnectionStatus("transcript sent");
  }

  function upsertPartialTranscript(text: string, itemId = "realtime") {
    const conversationId = activeConversationIdRef.current;
    if (!conversationId) return;
    const clean = text.trim();
    if (!clean) return;
    const partialId = `partial-${itemId}`;
    const time = elapsedLabel(elapsedSecondsRef.current);
    setTranscript((current) => {
      const next = [
        ...current.filter((line) => line.id !== partialId),
        {
          id: partialId,
          time,
          text: clean,
          partial: true,
        },
      ];
      transcriptRef.current = next;
      return next;
    });
  }

  function appendTranscript(text: string) {
    const conversationId = activeConversationIdRef.current;
    if (!conversationId) return;
    const clean = text.trim();
    if (!clean) return;
    const line: TranscriptLine = {
      id: `line-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      time: elapsedLabel(elapsedSecondsRef.current),
      text: clean,
    };
    setTranscript((current) => {
      if (isNearDuplicateTranscript(clean, current)) {
        transcriptRef.current = current.filter((item) => !item.partial);
        return transcriptRef.current;
      }
      const next = [...current.filter((item) => !item.partial), line];
      transcriptRef.current = next;
      sendTranscriptChunk(line, conversationId, activePrenoteRef.current);
      return next;
    });
  }

  function maybeQueueCue(nextTranscript: TranscriptLine[]) {
    if (
      !settings.autoCue
      || cueTimerRef.current
      || cueInFlightRef.current
      || !shouldGenerateCue(nextTranscript, cuesRef.current, activePrenote)
    ) return;
    const transcriptSnapshot = nextTranscript.slice(-8);
    const prenoteSnapshot = activePrenote;
    const settingsSnapshot = settings;
    setConnectionStatus("ai cue queued");
    cueTimerRef.current = window.setTimeout(() => {
      cueTimerRef.current = null;
      void generateCueForTranscript(transcriptSnapshot, prenoteSnapshot, settingsSnapshot);
    }, 350);
  }

  async function generateCueForTranscript(lines: TranscriptLine[], prenote: Prenote | null, conversationSettings: ConversationSettings) {
    if (!activeConversationIdRef.current) return;
    cueInFlightRef.current = true;
    setConnectionStatus("generating ai cue");
    try {
      const cue = await requestAiCue(lines, prenote, conversationSettings);
      if (!activeConversationIdRef.current) return;
      if (cue) {
        const nextCues = [cue, ...cuesRef.current].slice(0, 20);
        cuesRef.current = nextCues;
        setCues(nextCues);
        setConnectionStatus(shouldListenRef.current ? "listening" : "paused");
      } else {
        setConnectionStatus(shouldListenRef.current ? "listening" : "no cue needed");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setConnectionStatus(message.includes("not configured") ? "ai key missing" : "ai cue failed");
    } finally {
      cueInFlightRef.current = false;
    }
  }

  async function togglePrenote(id: string) {
    if (!authUser) return;
    const target = prenotes.find((note) => note.id === id);
    if (!target) return;
    const nextSelected = !target.selected;
    setPrenotes((current) => current.map((note) => note.id === id ? { ...note, selected: nextSelected } : note));
    setPrenotesError("");
    try {
      const updated = await updatePrenoteApi(authUser, id, { selected: nextSelected });
      setPrenotes((current) => current.map((note) => note.id === id ? updated : note));
    } catch (error) {
      setPrenotes((current) => current.map((note) => note.id === id ? target : note));
      setPrenotesError(error instanceof Error ? error.message : String(error));
    }
  }

  function openPrenoteDetail(note: Prenote | null) {
    setSwipedPrenoteId(null);
    setPrenotesError("");
    setActivePrenoteId(note?.id ?? null);
    setPrenoteDetailDraft({
      title: note?.title ?? "",
      text: note?.text ?? "",
      selected: note?.selected ?? true,
    });
    setScreen("prenoteDetail");
  }

  async function savePrenoteDetail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authUser || isSavingPrenote) return;
    const title = prenoteDetailDraft.title.trim();
    const text = prenoteDetailDraft.text.trim();
    if (!title && !text) {
      setPrenotesError("Title or context is required.");
      return;
    }

    setIsSavingPrenote(true);
    setPrenotesError("");
    try {
      if (activePrenoteId) {
        const updated = await updatePrenoteApi(authUser, activePrenoteId, {
          title,
          text,
          selected: prenoteDetailDraft.selected,
        });
        setPrenotes((current) => current.map((note) => note.id === activePrenoteId ? updated : note));
      } else {
        const created = await createPrenoteApi(authUser, {
          title,
          text,
          selected: prenoteDetailDraft.selected,
        });
        setPrenotes((current) => [created, ...current]);
        setActivePrenoteId(created.id);
      }
      setScreen("prenoteManager");
    } catch (error) {
      setPrenotesError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSavingPrenote(false);
    }
  }

  async function deletePrenote(id: string) {
    if (!authUser) return;
    const removed = prenotes.find((note) => note.id === id);
    const index = prenotes.findIndex((note) => note.id === id);
    setSwipedPrenoteId(null);
    setPrenotes((current) => current.filter((note) => note.id !== id));
    setPrenotesError("");
    try {
      await deletePrenoteApi(authUser, id);
      if (activePrenoteId === id) {
        setActivePrenoteId(null);
        setScreen("prenoteManager");
      }
    } catch (error) {
      if (removed) {
        setPrenotes((current) => {
          const next = [...current];
          next.splice(Math.max(index, 0), 0, removed);
          return next;
        });
      }
      setPrenotesError(error instanceof Error ? error.message : String(error));
    }
  }

  function submitAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = loginForm.email.trim().toLowerCase();
    const password = loginForm.password.trim();
    const name = loginForm.name.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setLoginError("Enter a valid email address.");
      return;
    }
    if (authMode === "signup" && name.length < 2) {
      setLoginError("Enter your name.");
      return;
    }
    if (password.length < 6) {
      setLoginError("Password must be at least 6 characters.");
      return;
    }
    if (authMode === "signup" && password !== loginForm.confirmPassword.trim()) {
      setLoginError("Passwords do not match.");
      return;
    }
    const nextUser: AuthUser = {
      name: authMode === "signup" ? name : displayNameFromEmail(email),
      email,
      role: "Student",
      signedInAt: new Date().toISOString(),
    };
    setAuthUser(nextUser);
    persistUser(nextUser);
    setAccountDraft({ name: nextUser.name, email: nextUser.email });
    setLoginError("");
    setLoginForm({ name: "", email, password: "", confirmPassword: "" });
    setAuthMode("signin");
    setScreen("home");
  }

  function saveAccount() {
    if (!authUser) return;
    const email = accountDraft.email.trim().toLowerCase();
    const name = accountDraft.name.trim();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    const nextUser = {
      ...authUser,
      name,
      email,
    };
    setAuthUser(nextUser);
    persistUser(nextUser);
  }

  function signOut() {
    if (activeConversationIdRef.current) {
      stopRecognition("signed out");
    }
    webSocketRef.current?.close();
    webSocketRef.current = null;
    setIsListening(false);
    setActiveConversationId(null);
    activeConversationIdRef.current = null;
    setAuthUser(null);
    setRecords([]);
    setRecordsError("");
    setPrenotes([]);
    setPrenotesError("");
    setSwipedPrenoteId(null);
    setActivePrenoteId(null);
    if (authUser) persistActiveConversation(authUser, null);
    persistUser(null);
    setIsAccountOpen(false);
    setScreen("home");
    setLoginForm({ name: "", email: authUser?.email ?? "student@cueflow.dev", password: "", confirmPassword: "" });
    setAuthMode("signin");
  }

  async function startConversation() {
    if (!authUser || isStartingConversation) return;
    setIsStartingConversation(true);
    setConnectionStatus("creating session");
    try {
      const conversation = await createConversationApi(authUser, runtimeConfigRef.current);
      const startedAt = dateFromIso(conversation.startedAt) ?? new Date();
      persistActiveConversation(authUser, {
        conversationId: conversation.conversationId,
        userId: userIdForApi(authUser),
        startedAt: startedAt.toISOString(),
        title: "New conversation",
      });
      setActiveConversationId(conversation.conversationId);
      activeConversationIdRef.current = conversation.conversationId;
      setActiveStartedAt(startedAt);
      setActiveRecordTitle("New conversation");
      setElapsedSeconds(0);
      elapsedSecondsRef.current = 0;
      setCues([]);
      setTranscript([]);
      transcriptRef.current = [];
      cuesRef.current = [];
      setIsListening(true);
      setLivePage("workspace");
      setScreen("live");
      await connectConversationSocket(conversation);
      void startRecognition();
    } catch (error) {
      setConnectionStatus("session start failed");
      setRecordsError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsStartingConversation(false);
    }
  }

  async function endConversation() {
    if (isEndingConversation) return;
    const conversationId = activeConversationIdRef.current;
    if (!conversationId) return;
    setIsEndingConversation(true);
    setIsListening(false);
    await stopRecognition("saving");
    await transcriptionQueueRef.current.catch(() => undefined);
    const finalTranscript = transcriptRef.current.filter((line) => !line.partial);
    const finalCues = cuesRef.current;
    const startedAt = activeStartedAt ?? new Date();
    const title = finalTranscript[0]?.text.slice(0, 52) || activeRecordTitle;
    const draftRecord: ConversationRecord = {
      id: conversationId,
      title,
      startedAt: formatRecordDate(startedAt),
      location: "CueFlow",
      duration: elapsedLabel(elapsedSecondsRef.current),
      summary: queuedSummary(title, "running"),
      transcript: finalTranscript,
      cueHistory: finalCues,
      usedPrenote: activePrenoteRef.current ?? undefined,
    };
    setRecords((current) => [draftRecord, ...current.filter((record) => record.id !== draftRecord.id)]);
    setActiveRecordId(draftRecord.id);
    setHistoryPage("workspace");
    setScreen("history");
    setConnectionStatus("saving summary");
    try {
      if (authUser) {
        await endConversationApi(
          authUser,
          runtimeConfigRef.current,
          conversationId,
          promptContextFromPrenote(activePrenoteRef.current),
          activePrenoteRef.current,
        );
        setConnectionStatus("summary queued");
        void refreshRecords(conversationId);
        window.setTimeout(() => void refreshRecords(conversationId), 5000);
        window.setTimeout(() => void refreshRecords(conversationId), 14000);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRecords((current) => current.map((record) => (
        record.id === conversationId ? { ...record, summary: queuedSummary(title, "failed", message) } : record
      )));
      setRecordsError(message);
      setConnectionStatus("save failed");
    } finally {
      webSocketRef.current?.close();
      webSocketRef.current = null;
      if (authUser) persistActiveConversation(authUser, null);
      setActiveConversationId(null);
      activeConversationIdRef.current = null;
      setIsEndingConversation(false);
    }
  }

  async function generateSummaryForRecord(record: ConversationRecord) {
    setRecords((current) => current.map((item) => (
      item.id === record.id ? { ...item, summary: queuedSummary(record.title, "running") } : item
    )));
    try {
      const summary = await requestAiSummary(record, settings.language);
      setRecords((current) => current.map((item) => (
        item.id === record.id
          ? { ...item, title: summary.title || item.title, summary: { ...summary, title: summary.title || item.title } }
          : item
      )));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRecords((current) => current.map((item) => (
        item.id === record.id ? { ...item, summary: queuedSummary(record.title, "failed", message) } : item
      )));
    }
  }

  function togglePauseConversation() {
    if (!activeConversationIdRef.current) return;
    if (isListening) {
      setIsListening(false);
      stopRecognition("paused");
    } else {
      setIsListening(true);
      void startRecognition();
    }
  }

  function openHistoryRecord(id: string) {
    if (swipedRecordId === id) {
      setSwipedRecordId(null);
      return;
    }
    setSelectedCueDetail(null);
    setHistoryPage("workspace");
    setActiveRecordId(id);
    setScreen("history");
  }

  function handleRecordPointerDown(id: string, event: { clientX: number; clientY: number }) {
    recordPointerRef.current = { id, x: event.clientX, y: event.clientY };
  }

  function handleRecordPointerUp(id: string, event: { clientX: number; clientY: number }) {
    const start = recordPointerRef.current;
    recordPointerRef.current = null;
    if (!start || start.id !== id) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 38 || Math.abs(deltaX) < Math.abs(deltaY)) return;
    skipNextRecordClickRef.current = true;
    setSwipedRecordId(deltaX < 0 ? id : null);
  }

  function handlePrenoteListClick(note: Prenote) {
    if (skipNextPrenoteClickRef.current) {
      skipNextPrenoteClickRef.current = false;
      return;
    }
    if (swipedPrenoteId === note.id) {
      setSwipedPrenoteId(null);
      return;
    }
    openPrenoteDetail(note);
  }

  function handlePrenotePointerDown(id: string, event: { clientX: number; clientY: number }) {
    prenotePointerRef.current = { id, x: event.clientX, y: event.clientY };
  }

  function handlePrenotePointerUp(id: string, event: { clientX: number; clientY: number }) {
    const start = prenotePointerRef.current;
    prenotePointerRef.current = null;
    if (!start || start.id !== id) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 38 || Math.abs(deltaX) < Math.abs(deltaY)) return;
    skipNextPrenoteClickRef.current = true;
    setSwipedPrenoteId(deltaX < 0 ? id : null);
  }

  function handleRecordClick(id: string) {
    if (skipNextRecordClickRef.current) {
      skipNextRecordClickRef.current = false;
      return;
    }
    openHistoryRecord(id);
  }

  function deleteHistoryRecord(id: string) {
    setRecords((current) => current.filter((record) => record.id !== id));
    setSwipedRecordId(null);
    if (activeRecordId === id) setActiveRecordId("");
  }

  function renderHeader(title: string, right?: React.ReactNode, backTarget: Screen = "home") {
    return (
      <header className="topbar">
        <button className="icon-button" aria-label="Back" onClick={() => setScreen(backTarget)}>
          <ArrowLeft size={27} strokeWidth={1.5} />
        </button>
        <h1>{title}</h1>
        <div className="topbar-right">{right}</div>
      </header>
    );
  }

  if (!authUser) {
    return (
      <main className="phone-shell login-page">
        <section className="login-panel">
          <div className="login-brand">
            <span className="login-mark">
              <ShieldCheck size={30} strokeWidth={1.55} />
            </span>
            <div>
              <h1>CueFlow</h1>
              <p>Conversation intelligence workspace</p>
            </div>
          </div>
          <div className="auth-mode-tabs" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              className={authMode === "signin" ? "active" : ""}
              onClick={() => {
                setAuthMode("signin");
                setLoginError("");
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              className={authMode === "signup" ? "active" : ""}
              onClick={() => {
                setAuthMode("signup");
                setLoginError("");
              }}
            >
              Create Account
            </button>
          </div>
          <form className="login-form" onSubmit={submitAuth}>
            {authMode === "signup" && (
              <label>
                <span>Name</span>
                <div className="login-input">
                  <UserRound size={20} strokeWidth={1.7} />
                  <input
                    autoComplete="name"
                    value={loginForm.name}
                    onChange={(event) => {
                      setLoginForm({ ...loginForm, name: event.target.value });
                      setLoginError("");
                    }}
                  />
                </div>
              </label>
            )}
            <label>
              <span>Email</span>
              <div className="login-input">
                <Mail size={20} strokeWidth={1.7} />
                <input
                  type="email"
                  autoComplete="email"
                  value={loginForm.email}
                  onChange={(event) => {
                    setLoginForm({ ...loginForm, email: event.target.value });
                    setLoginError("");
                  }}
                />
              </div>
            </label>
            <label>
              <span>Password</span>
              <div className="login-input">
                <LockKeyhole size={20} strokeWidth={1.7} />
                <input
                  type="password"
                  autoComplete="current-password"
                  value={loginForm.password}
                  onChange={(event) => {
                    setLoginForm({ ...loginForm, password: event.target.value });
                    setLoginError("");
                  }}
                />
              </div>
            </label>
            {authMode === "signup" && (
              <label>
                <span>Confirm Password</span>
                <div className="login-input">
                  <LockKeyhole size={20} strokeWidth={1.7} />
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={loginForm.confirmPassword}
                    onChange={(event) => {
                      setLoginForm({ ...loginForm, confirmPassword: event.target.value });
                      setLoginError("");
                    }}
                  />
                </div>
              </label>
            )}
            {loginError && <p className="login-error">{loginError}</p>}
            <button className="login-button" type="submit">
              {authMode === "signin" ? <LogIn size={23} strokeWidth={1.7} /> : <UserPlus size={23} strokeWidth={1.7} />}
              {authMode === "signin" ? "Sign In" : "Create Account"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  if (screen === "prenoteManager") {
    return (
      <main className="phone-shell settings-page prenote-manager-page">
        {renderHeader(
          "Prepared Notes",
          <button className="icon-button" type="button" aria-label="New prepared note" onClick={() => openPrenoteDetail(null)}>
            <Plus size={25} strokeWidth={1.7} />
          </button>,
          "home",
        )}
        <section className="settings-section">
          <div className="section-row compact">
            <h2>Manage Notes</h2>
            <span>{prenotes.length}</span>
          </div>
          {prenotesError && <p className="settings-error">{prenotesError}</p>}
          {prenotesLoading ? (
            <p className="empty-note-state">Loading</p>
          ) : (
            <div className="manage-note-list">
              {prenotes.length ? prenotes.map((note) => (
                <div className={swipedPrenoteId === note.id ? "prenote-list-row swiped" : "prenote-list-row"} key={note.id}>
                  <button className="prenote-delete-button" type="button" onClick={() => void deletePrenote(note.id)}>
                    Delete
                  </button>
                  <div
                    className="prenote-list-card"
                    role="button"
                    tabIndex={0}
                    onClick={() => handlePrenoteListClick(note)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") handlePrenoteListClick(note);
                    }}
                    onPointerDown={(event) => handlePrenotePointerDown(note.id, event)}
                    onPointerUp={(event) => handlePrenotePointerUp(note.id, event)}
                    onPointerCancel={() => {
                      prenotePointerRef.current = null;
                    }}
                  >
                    <span className={note.selected ? "note-checkbox checked" : "note-checkbox"}>{note.selected && <Check size={18} />}</span>
                    <div>
                      <h3>{note.title}</h3>
                      <p>{note.text.split(/\r?\n/).slice(0, 2).join(" ")}</p>
                    </div>
                    <ChevronRight size={30} strokeWidth={1.45} />
                  </div>
                </div>
              )) : <p className="empty-note-state">No prepared notes</p>}
            </div>
          )}
        </section>
      </main>
    );
  }

  if (screen === "prenoteDetail") {
    return (
      <main className="phone-shell settings-page prenote-detail-page">
        {renderHeader(activePrenoteId ? "Prepared Note" : "New Note", <span />, "prenoteManager")}
        <section className="settings-section">
          <form className="prenote-detail-form" onSubmit={savePrenoteDetail}>
            <input
              value={prenoteDetailDraft.title}
              placeholder="Title"
              onChange={(event) => setPrenoteDetailDraft({ ...prenoteDetailDraft, title: event.target.value })}
            />
            <textarea
              value={prenoteDetailDraft.text}
              placeholder="Context"
              onChange={(event) => setPrenoteDetailDraft({ ...prenoteDetailDraft, text: event.target.value })}
            />
            <label className="switch-row note-select-row">
              <span>Use in session</span>
              <input
                type="checkbox"
                checked={prenoteDetailDraft.selected}
                onChange={(event) => setPrenoteDetailDraft({ ...prenoteDetailDraft, selected: event.target.checked })}
              />
            </label>
            {prenotesError && <p className="settings-error">{prenotesError}</p>}
            <button className="save-note-button" type="submit" disabled={isSavingPrenote || (!prenoteDetailDraft.title.trim() && !prenoteDetailDraft.text.trim())}>
              <Check size={21} strokeWidth={1.8} />
              {isSavingPrenote ? "Saving" : "Save"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  if (screen === "settings") {
    return (
      <main className="phone-shell settings-page">
        {renderHeader("Settings", <span />, "home")}
        <section className="settings-section">
          <h2>Voice Input</h2>
          <div className="setting-card tall locked">
            <div className="setting-choice">Phone microphone <Check size={28} /></div>
          </div>
          <p className="muted-copy">CueFlow uses the phone browser microphone for live transcription.</p>
        </section>
        <section className="settings-section">
          <h2>Language</h2>
          <button className="setting-row" onClick={() => setSettings({
            ...settings,
            language: settings.language === "english" ? "chinese" : settings.language === "chinese" ? "auto" : "english",
          })}>
            <span>Speech language</span>
            <span>{settings.language === "english" ? "English" : settings.language === "chinese" ? "Chinese" : "Auto"} <ChevronRight size={25} /></span>
          </button>
        </section>
        <section className="settings-section">
          <div className="setting-card">
            <label className="switch-row">
              <span>Automatic AI cues</span>
              <input type="checkbox" checked={settings.autoCue} onChange={(event) => setSettings({ ...settings, autoCue: event.target.checked })} />
            </label>
            <button className="setting-row" onClick={() => setSettings({
              ...settings,
              cueDuration: settings.cueDuration === 5000 ? 10000 : settings.cueDuration === 10000 ? 15000 : settings.cueDuration === 15000 ? "forever" : 5000,
            })}>
              <span>Cue duration</span>
              <span>{settings.cueDuration === "forever" ? "Pinned" : `${settings.cueDuration / 1000}s`} <ChevronRight size={25} /></span>
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (screen === "conversationSettings") {
    return (
      <main className="phone-shell settings-page">
        {renderHeader("Conversation Settings", <span />, "live")}
        <section className="settings-section">
          <h2>Voice Input</h2>
          <div className="setting-card tall locked">
            <div className="setting-choice">Phone microphone <Check size={28} /></div>
          </div>
        </section>
        <section className="settings-section">
          <h2>Live Behavior</h2>
          <div className="setting-card">
            <label className="switch-row">
              <span>Automatic AI cues</span>
              <input type="checkbox" checked={settings.autoCue} onChange={(event) => setSettings({ ...settings, autoCue: event.target.checked })} />
            </label>
          </div>
        </section>
      </main>
    );
  }

  if (screen === "live") {
    const startedAtLabel = activeStartedAt ? `${formatClock(activeStartedAt)} - CueFlow` : "CueFlow";
    return (
      <main className="phone-shell live-page">
        {renderHeader("Conversation", (
          <button className="icon-button" aria-label="Conversation settings" onClick={() => setScreen("conversationSettings")}>
            <MoreHorizontal size={33} strokeWidth={1.5} />
          </button>
        ), "home")}
        <section className="conversation-title-card live-title">
          <div>
            <h2>{activeRecordTitle}</h2>
            <p>{startedAtLabel}</p>
            <p className="connection-status">Audio: {connectionStatus}</p>
          </div>
          <span className="live-duration"><span />{elapsedLabel(elapsedSeconds)}</span>
        </section>
        {renderConversationPages(livePage, setLivePage, Boolean(activePrenote))}
        <section className="live-content">
          {livePage === "workspace" ? renderLiveWorkspace(cues, transcript, setSelectedCueDetail) : renderPrenotePage(activePrenote)}
        </section>
        <footer className="live-actions">
          <button onClick={togglePauseConversation}>
            <Pause size={29} strokeWidth={1.4} /> {isListening ? "Pause" : "Resume"}
          </button>
          <button onClick={endConversation} disabled={isEndingConversation}>
            <X size={31} strokeWidth={1.35} /> {isEndingConversation ? "Saving" : "End"}
          </button>
        </footer>
        {selectedCueDetail && renderCueDetailModal(selectedCueDetail, () => setSelectedCueDetail(null))}
      </main>
    );
  }

  if (screen === "history" && activeRecord) {
    return (
      <main className="phone-shell history-page">
        {renderHeader("Conversation", (
          <button className="icon-button" aria-label="More">
            <MoreHorizontal size={33} strokeWidth={1.5} />
          </button>
        ), "home")}
        <section className="conversation-title-card">
          <div>
            <h2>{activeRecord.title}</h2>
            <p>{activeRecord.startedAt} - {activeRecord.location}</p>
          </div>
          <span>{activeRecord.duration}</span>
        </section>
        {renderConversationPages(historyPage, setHistoryPage, Boolean(activeRecord.usedPrenote))}
        <section className="history-content">
          {historyPage === "workspace" ? renderHistoryWorkspace(activeRecord, setSelectedCueDetail) : renderPrenotePage(activeRecord.usedPrenote || null)}
        </section>
        {selectedCueDetail && renderCueDetailModal(selectedCueDetail, () => setSelectedCueDetail(null))}
      </main>
    );
  }

  return (
    <main className="phone-shell home-page">
      <header className="home-header">
        <button className="user-menu-button" aria-label="User account" onClick={() => setIsAccountOpen(true)}>
          <span>{userInitials(authUser)}</span>
        </button>
        <h1>Sessions</h1>
        <button className="icon-button" aria-label="Settings" onClick={() => setScreen("settings")}>
          <Settings2 size={33} strokeWidth={1.55} />
        </button>
      </header>
      {isAccountOpen && (
        <aside className="account-overlay" role="presentation" onClick={() => setIsAccountOpen(false)}>
          <section className="account-sidebar" role="dialog" aria-modal="true" aria-label="User account" onClick={(event) => event.stopPropagation()}>
            <header>
              <div className="account-avatar">{userInitials(authUser)}</div>
              <button className="icon-button" type="button" aria-label="Close account" onClick={() => setIsAccountOpen(false)}>
                <X size={26} strokeWidth={1.6} />
              </button>
            </header>
            <div className="account-profile">
              <h2>{authUser.name}</h2>
              <p>{authUser.email}</p>
              <span>{authUser.role}</span>
            </div>
            <div className="account-stats">
              <div>
                <strong>{records.length}</strong>
                <span>Sessions</span>
              </div>
              <div>
                <strong>{Math.round(totalRecordMinutes)}</strong>
                <span>Minutes</span>
              </div>
              <div>
                <strong>{prenotes.filter((note) => note.selected).length}</strong>
                <span>Notes</span>
              </div>
            </div>
            <form className="account-form" onSubmit={(event) => {
              event.preventDefault();
              saveAccount();
            }}>
              <label>
                <span>Name</span>
                <input
                  value={accountDraft.name}
                  onChange={(event) => setAccountDraft({ ...accountDraft, name: event.target.value })}
                />
              </label>
              <label>
                <span>Email</span>
                <input
                  type="email"
                  value={accountDraft.email}
                  onChange={(event) => setAccountDraft({ ...accountDraft, email: event.target.value })}
                />
              </label>
              <button className="account-save-button" type="submit">
                <Check size={20} strokeWidth={1.8} />
                Save Profile
              </button>
            </form>
            <button className="account-row" type="button" onClick={() => {
              setIsAccountOpen(false);
              setScreen("settings");
            }}>
              <Settings2 size={21} strokeWidth={1.7} />
              App Settings
              <ChevronRight size={22} strokeWidth={1.5} />
            </button>
            <button className="account-signout" type="button" onClick={signOut}>
              <LogOut size={21} strokeWidth={1.7} />
              Sign Out
            </button>
          </section>
        </aside>
      )}

      <section className="home-start-section">
        <button className="start-button" onClick={startConversation} disabled={isStartingConversation}>
          <span>-&gt;</span> {isStartingConversation ? "Starting" : "Start"}
        </button>
      </section>

      <section className="record-section">
        <div className="section-row">
          <h2>My Records</h2>
          <span>{recordsLoading ? "..." : records.length}</span>
        </div>
        {recordsError && <p className="settings-error">{recordsError}</p>}
        <div className="record-list">
          {recordsLoading && !records.length ? <p className="empty-note-state">Loading</p> : null}
          {!recordsLoading && !records.length ? <p className="empty-note-state">No records yet</p> : null}
          {records.map((record) => (
            <div className={swipedRecordId === record.id ? "record-row swiped" : "record-row"} key={record.id}>
              <button className="record-delete-button" onClick={() => deleteHistoryRecord(record.id)}>
                Delete
              </button>
              <button
                className="record-card"
                onClick={() => handleRecordClick(record.id)}
                onPointerDown={(event) => handleRecordPointerDown(record.id, event)}
                onPointerUp={(event) => handleRecordPointerUp(record.id, event)}
                onPointerCancel={() => {
                  recordPointerRef.current = null;
                }}
              >
                <div>
                  <h3>{record.title}</h3>
                  <p>{record.startedAt} - {record.location}</p>
                </div>
                <ChevronRight size={34} strokeWidth={1.4} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="prenote-dock">
        <div className="prenote-title-row">
          <h2>Prepared Notes</h2>
          <button className="small-icon-button" type="button" aria-label="Manage prepared notes" onClick={() => setScreen("prenoteManager")}>
            <Plus size={22} strokeWidth={1.8} />
          </button>
        </div>
        <div className="prenote-row">
          {prenotes.length ? prenotes.map((note) => (
            <button className="prenote-card" key={note.id} onClick={() => void togglePrenote(note.id)}>
              <span className={note.selected ? "note-checkbox checked" : "note-checkbox"}>{note.selected && <Check size={18} />}</span>
              <h3>{note.title}</h3>
              <p>{note.text.split(/\r?\n/).slice(0, 2).join(" ")}</p>
            </button>
          )) : (
            <button className="prenote-card" type="button" onClick={() => setScreen("prenoteManager")}>
              <span className="note-checkbox" />
              <h3>No notes</h3>
              <p>Add context</p>
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

function renderConversationPages(active: ConversationPage, onChange: (page: ConversationPage) => void, hasPrenote: boolean) {
  return (
    <nav className="conversation-page-tabs" aria-label="Conversation pages">
      <button className={active === "workspace" ? "active" : ""} type="button" onClick={() => onChange("workspace")}>
        Workspace
      </button>
      <button
        className={active === "prenote" ? "active" : ""}
        type="button"
        disabled={!hasPrenote}
        onClick={() => onChange("prenote")}
      >
        Prepared Notes
      </button>
    </nav>
  );
}

function renderLiveWorkspace(cues: AiCue[], transcript: TranscriptLine[], onCueSelect: (cue: AiCue) => void) {
  return (
    <div className="dual-workspace live-workspace">
      {renderCuePanel(cues, onCueSelect)}
      <div className="workspace-side">
        {renderTranscript(transcript, true, "Transcript")}
      </div>
    </div>
  );
}

function renderHistoryWorkspace(record: ConversationRecord, onCueSelect: (cue: AiCue) => void) {
  return (
    <div className="dual-workspace history-workspace">
      {renderSummary(record, onCueSelect)}
      <div className="workspace-side">
        {renderTranscript(record.transcript, false, "Transcript")}
      </div>
    </div>
  );
}

function renderCuePanel(cues: AiCue[], onCueSelect: (cue: AiCue) => void) {
  const currentCue = cues[0];
  const olderCues = cues.slice(1, 7);
  const currentMeta = currentCue ? cueMetaItems(currentCue) : [];

  return (
    <section className="summary-card cue-panel-card">
      <div className="cue-panel-heading">
        <h2>Current AI Cue</h2>
        <span>{cues.length ? `${cues.length} total` : "Live"}</span>
      </div>
      {currentCue ? (
        <button className={`current-cue cue-tone-${currentCue.category}`} type="button" onClick={() => onCueSelect(currentCue)}>
          <div className="cue-card-top">
            <span className="cue-type-badge">
              <span>{cueIcon(currentCue.category)}</span>
              {cueLabel(currentCue.category)}
            </span>
            {formatCueConfidence(currentCue.confidence) ? (
              <span className="cue-confidence">{formatCueConfidence(currentCue.confidence)}</span>
            ) : null}
          </div>
          <h3>{currentCue.title}</h3>
          <p className="cue-short">{currentCue.shortText}</p>
          {currentCue.detailText !== currentCue.shortText ? <p className="cue-detail-preview">{currentCue.detailText}</p> : null}
          {currentMeta.length ? (
            <div className="cue-meta-row">
              {currentMeta.map((item) => <span key={item}>{item}</span>)}
            </div>
          ) : null}
        </button>
      ) : (
        <div className="empty-state summary-empty cue-empty-state">
          <span>No current cue</span>
          <small>Waiting</small>
        </div>
      )}
      <div className="cue-panel-heading cue-history-heading">
        <h2>Recent AI Cues</h2>
        <span>{olderCues.length ? `${olderCues.length}` : "-"}</span>
      </div>
      <div className="cue-list">
        {olderCues.length ? olderCues.map((cue) => (
          <button className={`cue-row cue-tone-${cue.category}`} key={cue.id} type="button" onClick={() => onCueSelect(cue)}>
            <span className="cue-icon" aria-hidden="true">{cueIcon(cue.category)}</span>
            <div>
              <div className="cue-row-title">
                <h3>{cue.title}</h3>
                <span>{cueLabel(cue.category)}</span>
              </div>
              <p>{cue.shortText}</p>
              <div className="cue-meta-row compact">
                {cueMetaItems(cue).map((item) => <span key={item}>{item}</span>)}
              </div>
            </div>
          </button>
        )) : <div className="empty-state cue-empty-state"><span>No earlier cue</span></div>}
      </div>
    </section>
  );
}

function renderSummary(record: ConversationRecord, onCueSelect: (cue: AiCue) => void) {
  const summary = record.summary;
  const isReady = summary.status === "ready";
  const overview = isReady
    ? summary.emptyReason === "too_short"
      ? "This conversation was too short for a detailed AI summary."
      : summary.overview || "-"
    : summary.status === "failed"
      ? "AI summary generation failed. Transcript and cues are still available."
      : summary.status === "queued" || summary.status === "running"
        ? "AI summary is being generated..."
        : "No AI summary yet.";

  return (
    <div className="summary-stack">
      <section className="summary-card">
        <h2>Conversation Summary</h2>
        <p>{overview}</p>
        <h2>Key Points</h2>
        <ul className="key-point-list">
          {summary.keyPoints.length ? summary.keyPoints.map((point) => (
            <li className="key-point-item" key={point.id}>
              <strong>{point.title}</strong>
              {point.details.length ? (
                <ul>
                  {point.details.map((detail, index) => <li key={`${point.id}-${index}`}>{detail}</li>)}
                </ul>
              ) : null}
            </li>
          )) : <li>-</li>}
        </ul>
      </section>
      <section className="summary-card">
        <div className="card-title-row">
          <h2>Action Items</h2>
          <span>Export ({summary.actionItems.length}/{summary.actionItems.length}) -&gt;</span>
        </div>
        <div className="summary-action-list">
          {summary.actionItems.length ? summary.actionItems.map((item) => (
            <article className="summary-action-item" key={item.id}>
              <span>{item.checked ? <Check size={17} strokeWidth={2.2} /> : null}</span>
              <p>{item.text}</p>
            </article>
          )) : <p>-</p>}
        </div>
      </section>
      {renderCueGroups(record.cueHistory, onCueSelect)}
    </div>
  );
}

function renderCueGroups(cues: AiCue[], onCueSelect: (cue: AiCue) => void) {
  const groups = groupCuesByCategory(cues);
  const visibleCategories = CUE_CATEGORY_ORDER.filter((category) => groups[category].length > 0);

  return (
    <section className="summary-card muted-cues">
      <h2>AI Cues</h2>
      {visibleCategories.length ? visibleCategories.map((category) => (
        <details className="cue-group" key={category} open>
          <summary>
            <span>{cueIcon(category)}</span>
            {cueLabel(category)}
          </summary>
          <div className="cue-chip-row">
            {groups[category].map((cue) => (
              <button className={`cue-chip cue-tone-${cue.category}`} key={cue.id} type="button" onClick={() => onCueSelect(cue)}>
                <span>{cueIcon(cue.category)}</span>
                <strong>{cueLabel(cue.category)}</strong>
                <span>{cue.title}</span>
              </button>
            ))}
          </div>
        </details>
      )) : <p>-</p>}
    </section>
  );
}

function renderCueDetailModal(cue: AiCue, onClose: () => void) {
  const metaItems = cueMetaItems(cue);

  return (
    <div className="cue-modal-backdrop" role="presentation" onClick={onClose}>
      <article className="cue-modal" role="dialog" aria-modal="true" aria-label={cue.title} onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span className="cue-modal-icon">{cueIcon(cue.category)}</span>
            <div>
              <span className="cue-type-badge">
                <span>{cueIcon(cue.category)}</span>
                {cueLabel(cue.category)}
              </span>
              <h2>{cue.title}</h2>
            </div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            <X size={24} strokeWidth={1.8} />
          </button>
        </header>
        <p className="cue-modal-short">{cue.shortText}</p>
        {cue.detailText !== cue.shortText ? <p>{cue.detailText}</p> : null}
        {metaItems.length ? (
          <div className="cue-meta-row modal-meta">
            {metaItems.map((item) => <span key={item}>{item}</span>)}
          </div>
        ) : null}
      </article>
    </div>
  );
}

function renderTranscript(lines: TranscriptLine[], autoFollow = false, title?: string) {
  return <TranscriptCard lines={lines} autoFollow={autoFollow} title={title} />;
}

function renderPrenotePage(note: Prenote | null) {
  return (
    <div className="conversation-prenote-page">
      {renderPrenote(note)}
    </div>
  );
}

function TranscriptCard({ lines, autoFollow, title }: { lines: TranscriptLine[]; autoFollow: boolean; title?: string }) {
  const scrollRef = useRef<HTMLElement | null>(null);
  const shouldFollowRef = useRef(true);
  const lastLine = lines[lines.length - 1];

  useEffect(() => {
    if (!autoFollow || !shouldFollowRef.current) return;
    const element = scrollRef.current;
    if (!element) return;
    const frame = window.requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoFollow, lines.length, lastLine?.id, lastLine?.text]);

  function handleScroll() {
    if (!autoFollow) return;
    const element = scrollRef.current;
    if (!element) return;
    shouldFollowRef.current = shouldAutoFollowTranscriptScroll({
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
      clientHeight: element.clientHeight,
    });
  }

  return (
    <section className="transcript-card" ref={scrollRef} onScroll={handleScroll}>
      {title && <h2>{title}</h2>}
      {lines.length ? lines.map((line) => (
        <article className={line.partial ? "partial" : ""} key={line.id}>
          <time>{line.time}</time>
          <p>{line.text}</p>
        </article>
      )) : <div className="empty-state">No transcript yet</div>}
    </section>
  );
}

function renderPrenote(note: Prenote | null) {
  return (
    <section className="summary-card prenote-readonly">
      <h2>{note?.title || "Prepared Notes"}</h2>
      <pre>{note?.text || "No prepared note selected"}</pre>
    </section>
  );
}
