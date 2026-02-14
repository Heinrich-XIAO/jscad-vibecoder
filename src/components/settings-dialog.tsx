"use client";

import { useState } from "react";
import { Settings, X, Key, Cpu, Sun, Moon, Monitor } from "lucide-react";
import {
  getOpenRouterSettings,
  saveOpenRouterSettings,
  AVAILABLE_MODELS,
} from "@/lib/openrouter";
import { useTheme } from "@/lib/theme-provider";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const [settings, setSettings] = useState(getOpenRouterSettings);
  const { theme, setTheme, resolvedTheme } = useTheme();

  if (!isOpen) return null;

  const handleSave = () => {
    saveOpenRouterSettings(settings);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-zinc-400" />
            <h2 className="text-lg font-semibold text-zinc-200">Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-zinc-800 rounded-md transition-colors"
          >
            <X className="w-5 h-5 text-zinc-400" />
          </button>
        </div>

        {/* OpenRouter API Key */}
        <div className="mb-5">
          <label className="flex items-center gap-2 text-sm font-medium text-zinc-400 mb-2">
            <Key className="w-3.5 h-3.5" />
            OpenRouter API Key
          </label>
          <input
            type="password"
            value={settings.apiKey}
            onChange={(e) =>
              setSettings({ ...settings, apiKey: e.target.value })
            }
            placeholder="sk-or-..."
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <p className="text-xs text-zinc-600 mt-1">
            Get your key at{" "}
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:underline"
            >
              openrouter.ai/keys
            </a>
          </p>
        </div>

        {/* Model selection */}
        <div className="mb-5">
          <label className="flex items-center gap-2 text-sm font-medium text-zinc-400 mb-2">
            <Cpu className="w-3.5 h-3.5" />
            Model
          </label>
          <select
            value={settings.model}
            onChange={(e) =>
              setSettings({ ...settings, model: e.target.value })
            }
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {AVAILABLE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.provider})
              </option>
            ))}
          </select>
        </div>

        {/* Theme selection */}
        <div className="mb-5">
          <label className="flex items-center gap-2 text-sm font-medium text-zinc-400 mb-2">
            {resolvedTheme === "dark" ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
            Theme
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(["light", "dark", "system"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                  theme === t
                    ? "bg-indigo-600 text-white"
                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                }`}
              >
                {t === "light" && <Sun className="w-4 h-4" />}
                {t === "dark" && <Moon className="w-4 h-4" />}
                {t === "system" && <Monitor className="w-4 h-4" />}
                <span className="capitalize">{t}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-600 mt-1">
            Currently using {resolvedTheme} mode
          </p>
        </div>

        {/* Temperature */}
        <div className="mb-6">
          <label className="text-sm font-medium text-zinc-400 mb-2 block">
            Temperature: {settings.temperature}
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={settings.temperature}
            onChange={(e) =>
              setSettings({
                ...settings,
                temperature: parseFloat(e.target.value),
              })
            }
            className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
          />
          <div className="flex justify-between text-xs text-zinc-600 mt-1">
            <span>Precise</span>
            <span>Creative</span>
          </div>
        </div>

        {/* Save */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-zinc-700 text-zinc-400 rounded-lg text-sm hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-500 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
