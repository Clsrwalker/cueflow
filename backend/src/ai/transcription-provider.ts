import OpenAI, { toFile } from "openai";

export const DEFAULT_OPENAI_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";

export type TranscriptionLanguage = "english" | "chinese" | "auto";

export type AudioTranscriptionInput = {
  audioBase64: string;
  mimeType?: string;
  language?: TranscriptionLanguage;
  promptContext?: string;
};

export type AudioTranscriptionResult = {
  text: string;
  model: string;
  language?: TranscriptionLanguage;
};

export type AudioTranscriber = {
  transcribe(input: AudioTranscriptionInput): Promise<AudioTranscriptionResult>;
};

type OpenAiTranscriptionClient = {
  audio: {
    transcriptions: Pick<OpenAI["audio"]["transcriptions"], "create">;
  };
};

export type OpenAiTranscriptionProviderOptions = {
  apiKey?: string;
  model?: string;
  client?: OpenAiTranscriptionClient;
};

function makeClient(options: OpenAiTranscriptionProviderOptions): OpenAiTranscriptionClient {
  if (options.client) return options.client;
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for OpenAI transcription.");
  }
  return new OpenAI({ apiKey });
}

function languageCode(language: TranscriptionLanguage | undefined): string | undefined {
  if (language === "english") return "en";
  if (language === "chinese") return "zh";
  return undefined;
}

function extensionForMimeType(mimeType: string | undefined): string {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.includes("mp4")) return "mp4";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("ogg")) return "ogg";
  return "webm";
}

function cleanMimeType(mimeType: string | undefined): string {
  const cleaned = String(mimeType || "").replace(/[\r\n]/g, "").trim();
  return cleaned.split(";")[0]?.trim() || "audio/webm";
}

export class OpenAiTranscriptionProvider implements AudioTranscriber {
  private readonly client: OpenAiTranscriptionClient;
  private readonly model: string;

  constructor(options: OpenAiTranscriptionProviderOptions = {}) {
    this.client = makeClient(options);
    this.model = options.model ?? process.env.OPENAI_TRANSCRIPTION_MODEL ?? DEFAULT_OPENAI_TRANSCRIPTION_MODEL;
  }

  async transcribe(input: AudioTranscriptionInput): Promise<AudioTranscriptionResult> {
    const mimeType = cleanMimeType(input.mimeType);
    const audio = Buffer.from(input.audioBase64, "base64");
    if (!audio.length) {
      return { text: "", model: this.model, language: input.language };
    }

    const response = await this.client.audio.transcriptions.create({
      file: await toFile(audio, `cueflow-audio.${extensionForMimeType(mimeType)}`, { type: mimeType }),
      model: this.model,
      response_format: "json",
      ...(languageCode(input.language) ? { language: languageCode(input.language) } : {}),
      ...(input.promptContext?.trim() ? { prompt: input.promptContext.trim().slice(0, 1200) } : {}),
    });

    return {
      text: response.text.trim(),
      model: this.model,
      language: input.language,
    };
  }
}
