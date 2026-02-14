"use client";

import { Keyboard, X } from "lucide-react";
import {
  type KeyboardShortcut,
  formatShortcut,
} from "@/lib/use-keyboard-shortcuts";

interface KeyboardShortcutsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  shortcuts: KeyboardShortcut[];
}

export function KeyboardShortcutsDialog({
  isOpen,
  onClose,
  shortcuts,
}: KeyboardShortcutsDialogProps) {
  if (!isOpen) return null;

  // Group shortcuts by their group label (default to "General")
  const grouped = shortcuts.reduce<Record<string, KeyboardShortcut[]>>(
    (acc, s) => {
      const group = s.group ?? "General";
      if (!acc[group]) acc[group] = [];
      acc[group].push(s);
      return acc;
    },
    {}
  );

  const groupOrder = Object.keys(grouped);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-zinc-400" />
            <h2 className="text-lg font-semibold text-zinc-200">
              Keyboard Shortcuts
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-zinc-800 rounded-md transition-colors"
          >
            <X className="w-5 h-5 text-zinc-400" />
          </button>
        </div>

        <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
          {groupOrder.map((group) => (
            <div key={group}>
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                {group}
              </h3>
              <div className="space-y-1">
                {grouped[group].map((shortcut, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-zinc-800/50"
                  >
                    <span className="text-sm text-zinc-300">
                      {shortcut.description}
                    </span>
                    <kbd className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-xs font-mono text-zinc-400 min-w-[2rem] justify-center">
                      {formatShortcut(shortcut)}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 pt-4 border-t border-zinc-800">
          <p className="text-xs text-zinc-600 text-center">
            Press <kbd className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-400 font-mono">?</kbd> to toggle this dialog
          </p>
        </div>
      </div>
    </div>
  );
}
