import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
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
  Trash2,
  UserPlus,
  UserRound,
  X,
} from "lucide-react";

type Screen = "home" | "settings" | "prenoteManager" | "live" | "history" | "conversationSettings";
type ConversationPage = "workspace" | "prenote";
type CueCategory = "response" | "concept" | "suggestion" | "person";
type SummaryStatus = "not_started" | "queued" | "running" | "ready" | "failed";
type SpeechLanguage = "english" | "chinese" | "auto";

type AiCue = {
  id: string;
  category: CueCategory;
  title: string;
  output: string;
  createdAt: string;
  source: "manual" | "auto";
};

type Prenote = {
  id: string;
  title: string;
  text: string;
  selected: boolean;
};

type PrenoteDraft = {
  title: string;
  text: string;
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
  category?: CueCategory | "none";
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

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0?: {
    transcript?: string;
  };
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
};

type SpeechRecognitionErrorLike = {
  error: string;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const TRANSCRIPT_FOLLOW_THRESHOLD_PX = 72;
const CUE_CATEGORY_ORDER: CueCategory[] = ["concept", "response", "suggestion", "person"];
const AUTH_STORAGE_KEY = "cueflow.authUser";
const OPENAI_KEY_STORAGE_KEY = "cueflow.openAiApiKey";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_AI_MODEL = "gpt-5.4-nano";
const DEFAULT_SUMMARY_MODEL = "gpt-5.5";

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
        output: "Persist transcript chunks first, then enqueue context windows for AI cue generation.",
        createdAt: new Date().toISOString(),
        source: "auto",
      },
      {
        id: "cue-2",
        category: "suggestion",
        title: "Demo talking point",
        output: "Show the live workspace with AI summary and transcript visible at the same time.",
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

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  const browserWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition ?? null;
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
  if (category === "concept") return <BookOpen size={22} strokeWidth={1.7} />;
  if (category === "response") return <span className="question-icon">?</span>;
  if (category === "suggestion") return <Lightbulb size={22} strokeWidth={1.7} />;
  return <UserRound size={22} strokeWidth={1.7} />;
}

function cueLabel(category: CueCategory): string {
  if (category === "concept") return "Concept";
  if (category === "response") return "Response";
  if (category === "suggestion") return "Suggestion";
  return "People";
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
    concept: cues.filter((cue) => cue.category === "concept"),
    response: cues.filter((cue) => cue.category === "response"),
    suggestion: cues.filter((cue) => cue.category === "suggestion"),
    person: cues.filter((cue) => cue.category === "person"),
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
    || /(什么|为什么|怎么|如何|是否|可以|需要|应该|解释|怎么办|下一步)/.test(value);
}

function promptContextFromPrenote(prenote: Prenote | null): string {
  if (!prenote) return "";
  return `Prepared context: ${prenote.title}\n${prenote.text}`.trim();
}

function shouldGenerateCue(lines: TranscriptLine[], cues: AiCue[], prenote: Prenote | null): boolean {
  const lastCue = cues[0];
  const recent = lastCue ? lines.slice(-3) : lines.slice(-2);
  const text = recent.map((line) => line.text).join(" ");
  const contextText = promptContextFromPrenote(prenote);
  return meaningfulLength(text) >= 12
    || Boolean(prenote && meaningfulLength(text) >= 5)
    || hasQuestionOrRequest(text)
    || /\b(risk|should|decision|latency|cloud|api|next)\b/i.test(`${contextText}\n${text}`);
}

function configuredAiEndpoint(): string {
  return import.meta.env.VITE_CUEFLOW_AI_ENDPOINT?.trim() ?? "";
}

function configuredOpenAiKey(): string {
  const buildKey = import.meta.env.VITE_OPENAI_API_KEY?.trim();
  if (buildKey) return buildKey;
  return storedOpenAiKey();
}

function storedOpenAiKey(): string {
  try {
    return window.localStorage.getItem(OPENAI_KEY_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

function persistOpenAiKey(value: string): void {
  try {
    const trimmed = value.trim();
    if (trimmed) window.localStorage.setItem(OPENAI_KEY_STORAGE_KEY, trimmed);
    else window.localStorage.removeItem(OPENAI_KEY_STORAGE_KEY);
  } catch {
    // Browsers can deny localStorage in private modes; calls will still fail clearly.
  }
}

function aiModel(defaultModel = DEFAULT_AI_MODEL): string {
  return import.meta.env.VITE_OPENAI_MODEL?.trim() || defaultModel;
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

function extractJsonObject(text: string): string {
  const cleaned = text.replace(/```json\n?/gi, "").replace(/```\n?/g, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  return firstBrace >= 0 && lastBrace > firstBrace ? cleaned.slice(firstBrace, lastBrace + 1) : cleaned;
}

function extractResponseText(data: unknown): string {
  const response = data && typeof data === "object" ? data as Record<string, unknown> : {};
  if (typeof response.output_text === "string") return response.output_text.trim();

  const texts: string[] = [];
  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    const content = item && typeof item === "object" && Array.isArray((item as Record<string, unknown>).content)
      ? (item as { content: unknown[] }).content
      : [];
    for (const contentItem of content) {
      if (contentItem && typeof contentItem === "object") {
        const text = (contentItem as Record<string, unknown>).text;
        if (typeof text === "string") texts.push(text);
      }
    }
  }
  return texts.join("\n").trim();
}

function parseAiJson<T>(text: string, label: string): T {
  const jsonText = extractJsonObject(text);
  try {
    return JSON.parse(jsonText) as T;
  } catch {
    throw new Error(`${label} response was not valid JSON.`);
  }
}

async function requestAiEndpoint<T>(path: "cue" | "summary", payload: unknown): Promise<T | null> {
  const endpoint = configuredAiEndpoint();
  if (!endpoint) return null;
  const response = await fetch(`${endpoint.replace(/\/+$/, "")}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`AI endpoint failed (${response.status}).`);
  const data = await response.json() as Record<string, unknown>;
  return (data[path] ?? data.data ?? data) as T;
}

async function requestOpenAiJson<T>(params: {
  label: string;
  system: string;
  prompt: string;
  model?: string;
  maxOutputTokens: number;
  temperature?: number | null;
}): Promise<T> {
  const apiKey = configuredOpenAiKey();
  if (!apiKey) {
    throw new Error("OpenAI API key is not configured.");
  }

  const system = [
    params.system,
    "Return valid JSON only. Do not include markdown, explanation, or extra text.",
  ].join("\n\n");
  const body: Record<string, unknown> = {
    model: params.model ?? aiModel(),
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `${system}\n\n${params.prompt}`,
          },
        ],
      },
    ],
    max_output_tokens: params.maxOutputTokens,
  };
  if (params.temperature !== null) {
    body.temperature = params.temperature ?? 0.05;
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`OpenAI request failed (${response.status}).`);
  }

  const data = await response.json();
  return parseAiJson<T>(extractResponseText(data), params.label);
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
  const category = value.category;
  if (!category || category === "none") return null;
  if (!CUE_CATEGORY_ORDER.includes(category)) return null;
  const title = cleanOneLine(value.title, 64);
  const output = cleanParagraph(value.output, 900);
  if (!title || !output) return null;

  return {
    id: `cue-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    category,
    title,
    output,
    createdAt: new Date().toISOString(),
    source: "auto",
  };
}

async function requestAiCue(lines: TranscriptLine[], prenote: Prenote | null, settings: ConversationSettings): Promise<AiCue | null> {
  const prompt = buildCuePrompt(lines, prenote, settings);
  const payload = { prompt, transcript: transcriptText(lines), prenote, settings };
  const endpointResult = await requestAiEndpoint<AiCueJson>("cue", payload);
  const raw = endpointResult ?? await requestOpenAiJson<AiCueJson>({
    label: "Cue",
    model: aiModel(DEFAULT_AI_MODEL),
    maxOutputTokens: 500,
    temperature: 0.05,
    system: [
      "You are CueFlow's high-precision automatic cue generator for live conversations.",
      "Create one useful cue for the latest transcript window.",
      "Prefer category response for a direct question or request.",
      "Use category concept for a useful knowledge point, suggestion for a concrete next step or trade-off, person for explicit people/role details, and none only for noise or weak context.",
      "Use selected prenote as background only when directly relevant. Do not invent facts outside the transcript.",
      'Return exactly one JSON object: { "category": "response|concept|suggestion|person|none", "confidence": 0.0, "title": "...", "output": "...", "reason": "..." }',
    ].join("\n"),
    prompt,
  });
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
  const endpointResult = await requestAiEndpoint<AiSummaryJson>("summary", payload);
  const raw = endpointResult ?? await requestOpenAiJson<AiSummaryJson>({
    label: "Summary",
    model: aiModel(DEFAULT_SUMMARY_MODEL),
    maxOutputTokens: 1200,
    temperature: null,
    system: [
      "You create CueFlow conversation summaries.",
      "Ground summaries in transcript facts. Use prepared notes only as background context.",
    ].join("\n"),
    prompt,
  });
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

export default function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => storedUser());
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
  const [records, setRecords] = useState<ConversationRecord[]>(SAMPLE_RECORDS);
  const [prenotes, setPrenotes] = useState<Prenote[]>(SAMPLE_PRENOTES);
  const [prenoteDraft, setPrenoteDraft] = useState<PrenoteDraft>({ title: "", text: "" });
  const [openAiKeyDraft, setOpenAiKeyDraft] = useState(() => storedOpenAiKey());
  const [cues, setCues] = useState<AiCue[]>([]);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [activeRecordId, setActiveRecordId] = useState<string>("");
  const [isListening, setIsListening] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState("ready");
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeStartedAt, setActiveStartedAt] = useState<Date | null>(null);
  const [activeRecordTitle, setActiveRecordTitle] = useState("New conversation");
  const [swipedRecordId, setSwipedRecordId] = useState<string | null>(null);
  const [selectedCueDetail, setSelectedCueDetail] = useState<AiCue | null>(null);

  const activePrenote = useMemo(() => selectedPrenote(prenotes), [prenotes]);
  const activeRecord = records.find((record) => record.id === activeRecordId) || records[0] || null;
  const totalRecordMinutes = records.reduce((total, record) => {
    const [minutes = "0", seconds = "0"] = record.duration.split(":");
    return total + Number(minutes) + Number(seconds) / 60;
  }, 0);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const shouldListenRef = useRef(false);
  const activeConversationIdRef = useRef<string | null>(null);
  const transcriptRef = useRef<TranscriptLine[]>([]);
  const cuesRef = useRef<AiCue[]>([]);
  const cueTimerRef = useRef<number | null>(null);
  const cueInFlightRef = useRef(false);
  const recordPointerRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const skipNextRecordClickRef = useRef(false);

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

  useEffect(() => () => {
    shouldListenRef.current = false;
    recognitionRef.current?.abort();
    if (cueTimerRef.current) window.clearTimeout(cueTimerRef.current);
  }, []);

  function createRecognition(): SpeechRecognitionLike | null {
    if (!window.isSecureContext) {
      setConnectionStatus("microphone requires https");
      return null;
    }
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setConnectionStatus("speech recognition unavailable");
      return null;
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = settings.language === "chinese" ? "zh-CN" : settings.language === "auto" ? navigator.language : "en-US";

    recognition.onstart = () => {
      setConnectionStatus("listening");
    };

    recognition.onresult = (event) => {
      let finalText = "";
      let partialText = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript?.trim() ?? "";
        if (!text) continue;
        if (result.isFinal) finalText = `${finalText} ${text}`.trim();
        else partialText = `${partialText} ${text}`.trim();
      }

      if (partialText) {
        upsertPartialTranscript(partialText);
      }
      if (finalText) {
        appendTranscript(finalText);
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "no-speech") {
        setConnectionStatus("listening");
        return;
      }
      shouldListenRef.current = false;
      setIsListening(false);
      setConnectionStatus(event.error === "not-allowed" || event.error === "service-not-allowed"
        ? "microphone blocked"
        : `audio error: ${event.error}`);
    };

    recognition.onend = () => {
      const shouldRestart = shouldListenRef.current && Boolean(activeConversationIdRef.current);
      if (!shouldRestart) return;
      window.setTimeout(() => {
        try {
          recognition.start();
        } catch {
          setConnectionStatus("listening");
        }
      }, 260);
    };

    return recognition;
  }

  function startRecognition() {
    const recognition = recognitionRef.current ?? createRecognition();
    if (!recognition) return;
    recognitionRef.current = recognition;
    shouldListenRef.current = true;
    try {
      recognition.start();
      setConnectionStatus("connecting audio");
    } catch {
      setConnectionStatus("listening");
    }
  }

  function stopRecognition(nextStatus = "paused") {
    shouldListenRef.current = false;
    try {
      recognitionRef.current?.stop();
    } catch {
      recognitionRef.current?.abort();
    }
    setConnectionStatus(nextStatus);
  }

  function upsertPartialTranscript(text: string) {
    const conversationId = activeConversationIdRef.current;
    if (!conversationId) return;
    const time = elapsedLabel(elapsedSeconds);
    setTranscript((current) => {
      const withoutPartial = current.filter((line) => !line.partial);
      const next = [...withoutPartial, { id: "partial", time, text, partial: true }];
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
      time: elapsedLabel(elapsedSeconds),
      text: clean,
    };
    setTranscript((current) => {
      const next = [...current.filter((item) => !item.partial), line];
      transcriptRef.current = next;
      maybeQueueCue(next);
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

  function togglePrenote(id: string) {
    setPrenotes((current) => current.map((note) => note.id === id ? { ...note, selected: !note.selected } : note));
  }

  function addPrenote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = prenoteDraft.text.trim();
    const explicitTitle = prenoteDraft.title.trim();
    if (!text && !explicitTitle) return;
    const title = explicitTitle || text.split(/\r?\n/).find(Boolean)?.slice(0, 48) || "Prepared Note";
    const note: Prenote = {
      id: `pn-${Date.now().toString(36)}`,
      title,
      text: text || title,
      selected: true,
    };
    setPrenotes((current) => [note, ...current]);
    setPrenoteDraft({ title: "", text: "" });
  }

  function updatePrenote(id: string, patch: Partial<Pick<Prenote, "title" | "text">>) {
    setPrenotes((current) => current.map((note) => (
      note.id === id
        ? {
            ...note,
            title: patch.title !== undefined ? patch.title : note.title,
            text: patch.text !== undefined ? patch.text : note.text,
          }
        : note
    )));
  }

  function deletePrenote(id: string) {
    setPrenotes((current) => current.filter((note) => note.id !== id));
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

  function saveOpenAiKey() {
    persistOpenAiKey(openAiKeyDraft);
    setConnectionStatus(openAiKeyDraft.trim() ? "ai key saved" : "ai key removed");
  }

  function signOut() {
    if (activeConversationIdRef.current) {
      stopRecognition("signed out");
    }
    setIsListening(false);
    setActiveConversationId(null);
    activeConversationIdRef.current = null;
    setAuthUser(null);
    persistUser(null);
    setIsAccountOpen(false);
    setScreen("home");
    setLoginForm({ name: "", email: authUser?.email ?? "student@cueflow.dev", password: "", confirmPassword: "" });
    setAuthMode("signin");
  }

  function startConversation() {
    const startedAt = new Date();
    const id = `conv-${Date.now().toString(36)}`;
    setActiveConversationId(id);
    activeConversationIdRef.current = id;
    setActiveStartedAt(startedAt);
    setActiveRecordTitle("New conversation");
    setElapsedSeconds(0);
    setCues([]);
    setTranscript([]);
    transcriptRef.current = [];
    cuesRef.current = [];
    setIsListening(true);
    setLivePage("workspace");
    setScreen("live");
    startRecognition();
  }

  function endConversation() {
    stopRecognition("saving");
    setIsListening(false);
    const finalTranscript = transcriptRef.current.filter((line) => !line.partial);
    const finalCues = cuesRef.current;
    const startedAt = activeStartedAt ?? new Date();
    const title = finalTranscript[0]?.text.slice(0, 52) || activeRecordTitle;
    const draftRecord: ConversationRecord = {
      id: activeConversationIdRef.current ?? `record-${Date.now().toString(36)}`,
      title,
      startedAt: formatRecordDate(startedAt),
      location: "CueFlow",
      duration: elapsedLabel(elapsedSeconds),
      summary: queuedSummary(title),
      transcript: finalTranscript,
      cueHistory: finalCues,
      usedPrenote: activePrenote ?? undefined,
    };
    setRecords((current) => [draftRecord, ...current.filter((record) => record.id !== draftRecord.id)]);
    setActiveRecordId(draftRecord.id);
    setActiveConversationId(null);
    activeConversationIdRef.current = null;
    setConnectionStatus("ready");
    setHistoryPage("workspace");
    setScreen("history");
    void generateSummaryForRecord(draftRecord);
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
      startRecognition();
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
        {renderHeader("Prepared Notes", <span />, "home")}
        <section className="settings-section">
          <h2>Add Prepared Note</h2>
          <form className="prenote-create-form" onSubmit={addPrenote}>
            <input
              value={prenoteDraft.title}
              placeholder="Title"
              onChange={(event) => setPrenoteDraft({ ...prenoteDraft, title: event.target.value })}
            />
            <textarea
              value={prenoteDraft.text}
              placeholder="Context"
              onChange={(event) => setPrenoteDraft({ ...prenoteDraft, text: event.target.value })}
            />
            <button type="submit" disabled={!prenoteDraft.title.trim() && !prenoteDraft.text.trim()}>
              <Plus size={21} strokeWidth={1.8} />
              Add Note
            </button>
          </form>
        </section>
        <section className="settings-section">
          <div className="section-row compact">
            <h2>Manage Notes</h2>
            <span>{prenotes.length}</span>
          </div>
          <div className="manage-note-list">
            {prenotes.length ? prenotes.map((note) => (
              <article className="manage-note-card" key={note.id}>
                <label className="switch-row note-select-row">
                  <span>Use in session</span>
                  <input type="checkbox" checked={note.selected} onChange={() => togglePrenote(note.id)} />
                </label>
                <input
                  value={note.title}
                  aria-label={`${note.title || "Prepared note"} title`}
                  onChange={(event) => updatePrenote(note.id, { title: event.target.value })}
                  onBlur={() => {
                    if (!note.title.trim()) updatePrenote(note.id, { title: "Prepared Note" });
                  }}
                />
                <textarea
                  value={note.text}
                  aria-label={`${note.title || "Prepared note"} context`}
                  onChange={(event) => updatePrenote(note.id, { text: event.target.value })}
                  onBlur={() => {
                    if (!note.text.trim()) updatePrenote(note.id, { text: note.title || "Prepared Note" });
                  }}
                />
                <button className="delete-note-button" type="button" onClick={() => deletePrenote(note.id)}>
                  <Trash2 size={20} strokeWidth={1.8} />
                  Delete
                </button>
              </article>
            )) : <p className="empty-note-state">-</p>}
          </div>
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
        <section className="settings-section">
          <h2>AI Provider</h2>
          <div className="setting-card ai-provider-card">
            <label className="setting-input-row">
              <span>OpenAI API key</span>
              <input
                type="password"
                autoComplete="off"
                value={openAiKeyDraft}
                placeholder={configuredAiEndpoint() ? "Backend endpoint configured" : "sk-..."}
                onChange={(event) => setOpenAiKeyDraft(event.target.value)}
              />
            </label>
            <button className="setting-row" type="button" onClick={saveOpenAiKey}>
              <span>Save AI key</span>
              <span>{configuredAiEndpoint() ? "Endpoint" : openAiKeyDraft.trim() || configuredOpenAiKey() ? "Ready" : "Missing"} <ChevronRight size={25} /></span>
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
          {livePage === "workspace" ? renderLiveWorkspace(cues, transcript) : renderPrenotePage(activePrenote)}
        </section>
        <footer className="live-actions">
          <button onClick={togglePauseConversation}>
            <Pause size={29} strokeWidth={1.4} /> {isListening ? "Pause" : "Resume"}
          </button>
          <button onClick={endConversation}>
            <X size={31} strokeWidth={1.35} /> End
          </button>
        </footer>
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
        <button className="start-button" onClick={startConversation}>
          <span>-&gt;</span> Start
        </button>
      </section>

      <section className="record-section">
        <div className="section-row">
          <h2>My Records</h2>
          <span>{records.length}</span>
        </div>
        <div className="record-list">
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
          {prenotes.map((note) => (
            <button className="prenote-card" key={note.id} onClick={() => togglePrenote(note.id)}>
              <span className={note.selected ? "note-checkbox checked" : "note-checkbox"}>{note.selected && <Check size={18} />}</span>
              <h3>{note.title}</h3>
              <p>{note.text.split(/\r?\n/).slice(0, 2).join(" ")}</p>
            </button>
          ))}
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

function renderLiveWorkspace(cues: AiCue[], transcript: TranscriptLine[]) {
  return (
    <div className="dual-workspace live-workspace">
      {renderCuePanel(cues)}
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

function renderCuePanel(cues: AiCue[]) {
  return (
    <section className="summary-card cue-panel-card">
      <h2>Current AI Cue</h2>
      {cues[0] ? <p className="panel-copy">{cues[0].output}</p> : <div className="empty-state summary-empty">-</div>}
      <h2>AI Cues</h2>
      <div className="cue-list">
        {cues.length ? cues.slice(0, 6).map((cue) => (
          <article className="cue-row" key={cue.id}>
            <span className="cue-icon">{cueIcon(cue.category)}</span>
            <div>
              <h3>{cue.title}</h3>
              <p>{cue.output}</p>
            </div>
          </article>
        )) : <div className="empty-state">-</div>}
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
              <button className="cue-chip" key={cue.id} type="button" onClick={() => onCueSelect(cue)}>
                <span>{cueIcon(cue.category)}</span>
                {cue.title}
              </button>
            ))}
          </div>
        </details>
      )) : <p>-</p>}
    </section>
  );
}

function renderCueDetailModal(cue: AiCue, onClose: () => void) {
  return (
    <div className="cue-modal-backdrop" role="presentation" onClick={onClose}>
      <article className="cue-modal" role="dialog" aria-modal="true" aria-label={cue.title} onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span>{cueIcon(cue.category)}</span>
            <h2>{cue.title}</h2>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            <X size={24} strokeWidth={1.8} />
          </button>
        </header>
        <p>{cue.output}</p>
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
      )) : <div className="empty-state">-</div>}
    </section>
  );
}

function renderPrenote(note: Prenote | null) {
  return (
    <section className="summary-card prenote-readonly">
      <h2>{note?.title || "Prepared Notes"}</h2>
      <pre>{note?.text || "-"}</pre>
    </section>
  );
}
