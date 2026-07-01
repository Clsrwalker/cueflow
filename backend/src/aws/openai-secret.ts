import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

let cachedApiKey = "";

function extractOpenAiApiKey(secretText: string): string {
  const raw = secretText.trim();
  if (!raw) return "";

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "string") return parsed.trim();
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      for (const field of ["OPENAI_API_KEY", "openaiApiKey", "openai_api_key", "apiKey", "key"]) {
        const value = record[field];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
    }
  } catch {
    // Plain-text Secrets Manager values are supported.
  }

  return raw;
}

export async function configureOpenAiFromSecret(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (env.OPENAI_API_KEY?.trim()) return;
  if (cachedApiKey) {
    env.OPENAI_API_KEY = cachedApiKey;
    return;
  }

  const secretId = env.OPENAI_SECRET_ID?.trim();
  if (!secretId) return;

  const client = new SecretsManagerClient({});
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  const secretText = typeof response.SecretString === "string"
    ? response.SecretString
    : response.SecretBinary
      ? Buffer.from(response.SecretBinary).toString("utf8")
      : "";
  cachedApiKey = extractOpenAiApiKey(secretText);
  if (cachedApiKey) env.OPENAI_API_KEY = cachedApiKey;
}
