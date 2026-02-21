/**
 * OpenRouter settings management — stored in localStorage.
 */

export interface OpenRouterSettings {
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

const STORAGE_KEY = "openmech-openrouter";

const DEFAULT_SETTINGS: OpenRouterSettings = {
  apiKey: "",
  model: "google/gemini-3-flash-preview|reasoning=high",
  maxTokens: 4096,
  temperature: 0.3,
};

function normalizeUrl(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, "");
}

const BASE_URL =
  normalizeUrl(process.env.NEXT_PUBLIC_OPENROUTER_BASE_URL) ??
  normalizeUrl(process.env.OPENROUTER_BASE_URL) ??
  "https://openrouter.ai";

const PROXY_URL =
  normalizeUrl(process.env.NEXT_PUBLIC_OPENROUTER_PROXY_URL) ??
  normalizeUrl(process.env.OPENROUTER_PROXY_URL);

function resolveApiBaseUrl() {
  if (PROXY_URL) return PROXY_URL;

  if (/\/proxy\/v1$/i.test(BASE_URL)) {
    return BASE_URL;
  }

  if (/^https:\/\/ai\.hackclub\.com$/i.test(BASE_URL)) {
    return `${BASE_URL}/proxy/v1`;
  }

  return `${BASE_URL}/api/v1`;
}

const API_BASE_URL = resolveApiBaseUrl();

export const OPENROUTER_BASE_URL = BASE_URL;
export const OPENROUTER_PROXY_URL = PROXY_URL;
export const OPENROUTER_API_BASE_URL = API_BASE_URL;

export function getOpenRouterEndpoint(path: string) {
  const normalizedPath =
    (path.startsWith("/") ? path : `/${path}`).replace(/^\/api\/v1(?=\/|$)/, "") ||
    "/";

  return `${API_BASE_URL}${normalizedPath}`;
}

export function getOpenRouterSettings(): OpenRouterSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch {
    // Ignore parse errors
  }

  return DEFAULT_SETTINGS;
}

export function saveOpenRouterSettings(
  settings: Partial<OpenRouterSettings>
): OpenRouterSettings {
  const current = getOpenRouterSettings();
  const updated = { ...current, ...settings };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage errors
  }

  return updated;
}

export const AVAILABLE_MODELS = [
  { id: "z-ai/glm-5", name: "GLM-5", provider: "Z-AI" },
  { id: "google/gemini-3-flash-preview|reasoning=low", name: "Gemini 3 Flash Preview (Low)", provider: "Google" },
  { id: "google/gemini-3-flash-preview|reasoning=high", name: "Gemini 3 Flash Preview (High)", provider: "Google" },
  { id: "openai/gpt-5.2-codex", name: "GPT-5.2 Codex", provider: "OpenAI" },
  { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5", provider: "Anthropic" },
  { id: "anthropic/claude-opus-4.6", name: "Claude Opus 4.6", provider: "Anthropic" },
  { id: "moonshotai/kimi-k2.5", name: "Kimi K2.5", provider: "Moonshot" },
] as const;
