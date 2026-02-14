/**
 * OpenRouter settings management — stored in localStorage.
 */

export interface OpenRouterSettings {
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

const STORAGE_KEY = "jscad-vibe-openrouter";

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
  { id: "google/gemini-2.5-pro-preview-06-05", name: "Gemini 2.5 Pro", provider: "Google" },
  { id: "google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash", provider: "Google" },
  { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5", provider: "Anthropic" },
  { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4", provider: "Anthropic" },
  { id: "anthropic/claude-opus-4", name: "Claude Opus 4", provider: "Anthropic" },
  { id: "openai/gpt-4o", name: "GPT-4o", provider: "OpenAI" },
  { id: "openai/gpt-4o-mini", name: "GPT-4o Mini", provider: "OpenAI" },
  { id: "deepseek/deepseek-chat", name: "DeepSeek Chat", provider: "DeepSeek" },
] as const;
