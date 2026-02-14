import { useEffect, useCallback } from "react";

export interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: () => void;
  description: string;
  /** Optional group label for the help dialog (e.g. "Editor", "Navigation") */
  group?: string;
  /** If true, the shortcut will fire even when focus is in an input/textarea (default: false for non-modifier keys) */
  alwaysEnabled?: boolean;
}

/**
 * Returns true when the active element is a text input, textarea,
 * contentEditable element, or inside the Monaco editor.
 */
function isEditableTarget(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (!target) return false;

  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;

  // Monaco editor lives inside elements with class containing "monaco"
  if (target.closest?.(".monaco-editor")) return true;

  return false;
}

/**
 * Returns true when the shortcut uses at least one modifier key
 * (Ctrl, Meta/Cmd, or Alt). Shift alone doesn't count because
 * it's used for regular typing (e.g. Shift+/ = ?).
 */
function hasModifier(shortcut: KeyboardShortcut): boolean {
  return !!(shortcut.ctrl || shortcut.meta || shortcut.alt);
}

export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]) {
  const handler = useCallback(
    (e: KeyboardEvent) => {
      for (const shortcut of shortcuts) {
        const ctrlMatch =
          shortcut.ctrl === undefined ||
          shortcut.ctrl === (e.ctrlKey || e.metaKey);
        const metaMatch =
          shortcut.meta === undefined || shortcut.meta === e.metaKey;
        const shiftMatch =
          shortcut.shift === undefined || shortcut.shift === e.shiftKey;
        const altMatch =
          shortcut.alt === undefined || shortcut.alt === e.altKey;
        const keyMatch =
          shortcut.key.toLowerCase() === e.key.toLowerCase();

        if (ctrlMatch && metaMatch && shiftMatch && altMatch && keyMatch) {
          // When the user is inside an editable field, only fire
          // shortcuts that require a modifier key.  Plain keys like
          // "?" or "Escape" should be left to the input/editor.
          // Unless 'alwaysEnabled' is explicitly true.
          if (
            !shortcut.alwaysEnabled &&
            isEditableTarget(e) &&
            !hasModifier(shortcut)
          ) {
            continue;
          }

          e.preventDefault();
          shortcut.handler();
          break;
        }
      }
    },
    [shortcuts]
  );

  useEffect(() => {
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handler]);
}

/**
 * Format a shortcut for display.
 * Returns e.g. "Ctrl+S", "Cmd+Shift+E", "?".
 */
export function formatShortcut(shortcut: KeyboardShortcut): string {
  const isMac =
    typeof navigator !== "undefined" &&
    /mac/i.test(navigator.userAgent);

  const parts: string[] = [];

  if (shortcut.ctrl) {
    parts.push(isMac ? "\u2318" : "Ctrl");
  }
  if (shortcut.meta && !shortcut.ctrl) {
    parts.push(isMac ? "\u2318" : "Meta");
  }
  if (shortcut.alt) {
    parts.push(isMac ? "\u2325" : "Alt");
  }
  if (shortcut.shift) {
    parts.push(isMac ? "\u21E7" : "Shift");
  }

  // Friendly key names
  const keyNames: Record<string, string> = {
    enter: "\u21B5",
    escape: "Esc",
    " ": "Space",
    arrowup: "\u2191",
    arrowdown: "\u2193",
    arrowleft: "\u2190",
    arrowright: "\u2192",
    ",": ",",
    "/": "/",
    "?": "?",
  };

  const displayKey =
    keyNames[shortcut.key.toLowerCase()] ??
    shortcut.key.toUpperCase();

  parts.push(displayKey);

  return parts.join(isMac ? "" : "+");
}
