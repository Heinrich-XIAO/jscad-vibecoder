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
  model: "z-ai/glm-4.7",
  maxTokens: 4096,
  temperature: 0.3,
};

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
  { id: "z-ai/glm-4.7", name: "GLM-4.7", provider: "Z-AI" },
  { id: "google/gemini-3-flash-preview|reasoning=low", name: "Gemini 3 Flash Preview (Low)", provider: "Google" },
  { id: "google/gemini-3-flash-preview|reasoning=high", name: "Gemini 3 Flash Preview (High)", provider: "Google" },
  { id: "openai/gpt-5.2-codex", name: "GPT-5.2 Codex", provider: "OpenAI" },
  { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5", provider: "Anthropic" },
  { id: "anthropic/claude-opus-4.6", name: "Claude Opus 4.6", provider: "Anthropic" },
  { id: "moonshotai/kimi-k2.5", name: "Kimi K2.5", provider: "Moonshot" },
] as const;
