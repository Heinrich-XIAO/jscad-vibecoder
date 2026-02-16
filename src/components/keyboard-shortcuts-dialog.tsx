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
      <div className="bg-card border border-border rounded-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold text-foreground">
              Keyboard Shortcuts
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-secondary rounded-md transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
          {groupOrder.map((group) => (
            <div key={group}>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {group}
              </h3>
              <div className="space-y-1">
                {grouped[group].map((shortcut, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-secondary/50"
                  >
                    <span className="text-sm text-secondary-foreground">
                      {shortcut.description}
                    </span>
                    <kbd className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-secondary border border-border rounded text-xs font-mono text-muted-foreground min-w-[2rem] justify-center">
                      {formatShortcut(shortcut)}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 pt-4 border-t border-border">
          <p className="text-xs text-muted-foreground text-center">
            Press <kbd className="px-1.5 py-0.5 bg-secondary border border-border rounded text-muted-foreground font-mono">?</kbd> to toggle this dialog
          </p>
        </div>
      </div>
    </div>
  );
}
