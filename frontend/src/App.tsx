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

function promptContextFromPrenote(prenote: Prenote | null): string {
  if (!prenote) return "";
  return `Prepared context: ${prenote.title}\n${prenote.text}`.trim();
}

function buildCue(lines: TranscriptLine[], prenote: Prenote | null): AiCue {
  const text = lines.map((line) => line.text).join(" ");
  const promptContext = promptContextFromPrenote(prenote);
  const lower = `${promptContext}\n${text}`.toLowerCase();
  const id = `cue-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const createdAt = new Date().toISOString();
  const contextLead = prenote ? `Using "${prenote.title}" as prepared context, ` : "";

  if (/\b(risk|failure|latency|cost|security|reliability|slow)\b/.test(lower)) {
    return {
      id,
      category: "suggestion",
      title: "Risk to address",
      output: `${contextLead}the conversation is surfacing operational risk. Capture the mitigation before the topic moves on.`,
      createdAt,
      source: "auto",
    };
  }

  if (/\b(should|next|todo|need to|action|follow up)\b/.test(lower)) {
    return {
      id,
      category: "response",
      title: "Possible next response",
      output: `${contextLead}ask for the owner, timeline, and expected outcome so this becomes a concrete action item.`,
      createdAt,
      source: "auto",
    };
  }

  if (/\b(websocket|sqs|dynamodb|s3|lambda|cloud|architecture|api)\b/.test(lower)) {
    return {
      id,
      category: "concept",
      title: "Architecture concept",
      output: `${contextLead}separate live ingestion, durable storage, and AI processing so each cloud component has one clear responsibility.`,
      createdAt,
      source: "auto",
    };
  }

  if (prenote) {
    return {
      id,
      category: "concept",
      title: "Use prepared context",
      output: `Use "${prenote.title}" as the prompt context for the next answer: ${prenote.text.slice(0, 140)}`,
      createdAt,
      source: "auto",
    };
  }

  return {
    id,
    category: "response",
    title: "Follow-up prompt",
    output: "Ask a short clarifying question and keep the conversation moving.",
    createdAt,
    source: "auto",
  };
}

function shouldGenerateCue(lines: TranscriptLine[], cues: AiCue[], prenote: Prenote | null): boolean {
  const lastCue = cues[0];
  const recent = lastCue ? lines.slice(-3) : lines.slice(-2);
  const text = recent.map((line) => line.text).join(" ");
  const contextText = promptContextFromPrenote(prenote);
  return words(text) >= 18
    || Boolean(prenote && words(text) >= 8)
    || /[?]/.test(text)
    || /\b(risk|should|decision|latency|cloud|api|next)\b/i.test(`${contextText}\n${text}`);
}

function buildSummary(record: Pick<ConversationRecord, "title" | "transcript" | "cueHistory" | "usedPrenote">): ConversationSummary {
  const text = record.transcript.map((line) => line.text).join(" ");
  const promptContext = promptContextFromPrenote(record.usedPrenote ?? null);
  const lower = `${promptContext}\n${text}`.toLowerCase();
  const keyPoints: ConversationSummaryKeyPoint[] = [];
  if (record.usedPrenote) {
    keyPoints.push({
      id: "kp-prenote",
      title: "Prepared context used",
      details: [`Prompt context came from "${record.usedPrenote.title}".`],
    });
  }
  if (/\b(websocket|live|real-time|transcript)\b/.test(lower)) {
    keyPoints.push({
      id: "kp-live",
      title: "Live conversation flow",
      details: ["Transcript is captured inside the session page.", "AI cue generation follows the live transcript context."],
    });
  }
  if (/\b(sqs|queue|async|latency|worker)\b/.test(lower)) {
    keyPoints.push({
      id: "kp-async",
      title: "Async AI processing",
      details: ["AI work should not block transcript ingestion.", "Queue retries help keep the system resilient."],
    });
  }
  if (/\b(s3|dynamodb|storage|history|summary)\b/.test(lower)) {
    keyPoints.push({
      id: "kp-storage",
      title: "Durable history",
      details: ["Keep session metadata queryable and preserve transcript text for review."],
    });
  }

  const actionItems = record.transcript
    .filter((line) => /\b(should|need to|next|todo|follow up|action)\b/i.test(line.text))
    .slice(0, 4)
    .map((line, index) => ({ id: `act-${index}`, text: line.text, checked: index === 0 }));

  return {
    status: "ready",
    title: record.title,
    overview: text
      ? `This session covered ${(keyPoints.length ? keyPoints : [{ title: "conversation context" }]).map((point) => point.title).slice(0, 3).join(", ")}.`
      : "This session did not contain enough transcript content for a detailed summary.",
    keyPoints: keyPoints.length ? keyPoints : [
      { id: "kp-empty", title: "Conversation context", details: ["No major themes were detected yet."] },
    ],
    actionItems: actionItems.length ? actionItems : [
      { id: "act-review", text: "Review the transcript and choose the next follow-up.", checked: false },
    ],
    emptyReason: text ? undefined : "too_short",
    generatedAt: new Date().toISOString(),
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
  const [settings, setSettings] = useState<ConversationSettings>(DEFAULT_SETTINGS);
  const [records, setRecords] = useState<ConversationRecord[]>(SAMPLE_RECORDS);
  const [prenotes, setPrenotes] = useState<Prenote[]>(SAMPLE_PRENOTES);
  const [prenoteDraft, setPrenoteDraft] = useState<PrenoteDraft>({ title: "", text: "" });
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
    if (!settings.autoCue || cueTimerRef.current || !shouldGenerateCue(nextTranscript, cuesRef.current, activePrenote)) return;
    setConnectionStatus("cue queued");
    cueTimerRef.current = window.setTimeout(() => {
      const cue = buildCue(nextTranscript.slice(-4), activePrenote);
      const nextCues = [cue, ...cuesRef.current];
      cuesRef.current = nextCues;
      setCues(nextCues);
      setConnectionStatus(isListening ? "listening" : "paused");
      cueTimerRef.current = null;
    }, 650);
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
      summary: {
        status: "queued",
        title,
        overview: "AI summary is being generated...",
        keyPoints: [],
        actionItems: [],
      },
      transcript: finalTranscript,
      cueHistory: finalCues,
      usedPrenote: activePrenote ?? undefined,
    };
    const readyRecord = {
      ...draftRecord,
      summary: buildSummary(draftRecord),
    };
    setRecords((current) => [readyRecord, ...current.filter((record) => record.id !== readyRecord.id)]);
    setActiveRecordId(readyRecord.id);
    setActiveConversationId(null);
    activeConversationIdRef.current = null;
    setConnectionStatus("ready");
    setScreen("history");
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
        <section className="live-content">
          {renderLiveWorkspace(cues, transcript, activePrenote)}
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
        <section className="history-content">
          {renderHistoryWorkspace(activeRecord, setSelectedCueDetail)}
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

function renderLiveWorkspace(cues: AiCue[], transcript: TranscriptLine[], activePrenote: Prenote | null) {
  return (
    <div className="dual-workspace live-workspace">
      {renderCuePanel(cues)}
      <div className="workspace-side">
        {renderTranscript(transcript, true, "Transcript")}
        {activePrenote && renderPrenote(activePrenote)}
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
        {record.usedPrenote && renderPrenote(record.usedPrenote)}
      </div>
    </div>
  );
}

function renderCuePanel(cues: AiCue[]) {
  return (
    <section className="summary-card cue-panel-card">
      <h2>AI Summary</h2>
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
