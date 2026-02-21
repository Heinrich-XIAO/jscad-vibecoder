"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { useTheme } from "@/lib/theme-provider";
import Editor, { type OnMount } from "@monaco-editor/react";
import { ChevronRight, Code2 } from "lucide-react";
import type { JscadExecutionError } from "@/lib/jscad-worker";

export interface CodeEditorHandle {
  format: () => void;
}

interface CodeEditorProps {
  code: string;
  onChange: (code: string) => void;
  readOnly?: boolean;
  error?: JscadExecutionError | null;
  className?: string;
}

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(({
  code,
  onChange,
  readOnly = false,
  error,
  className = "",
}, ref) => {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const decorationIdsRef = useRef<string[]>([]);
  const [isStackExpanded, setIsStackExpanded] = useState(false);

  const extractLocation = useCallback((text?: string) => {
    if (!text) return null;
    const patterns = [
      /<anonymous>:(\d+):(\d+)/,
      /eval at [^\n]*<anonymous>:(\d+):(\d+)/,
      /:(\d+):(\d+)/,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const line = Number(match[1]);
        const column = Number(match[2]);
        if (Number.isFinite(line) && line > 0 && Number.isFinite(column) && column > 0) {
          return { line, column };
        }
      }
    }
    return null;
  }, []);

  const fallbackLocation = useMemo(() => {
    return extractLocation(error?.stack) ?? extractLocation(error?.message);
  }, [error?.message, error?.stack, extractLocation]);

  const errorLine = error?.line ?? fallbackLocation?.line;
  const errorColumn = error?.column ?? fallbackLocation?.column;
  const primaryMessage = error?.message?.split("\n")[0] ?? "";
  const stackText = error?.stack?.trim() ?? "";
  const hasStack = stackText.length > 0;

  const updateErrorMarker = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    if (!editor || !monaco || !model) return;

    if (!error || !errorLine) {
      monaco.editor.setModelMarkers(model, "jscad-runtime", []);
      decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, []);
      return;
    }

    const markerColumn = errorColumn ?? 1;
    monaco.editor.setModelMarkers(model, "jscad-runtime", [
      {
        startLineNumber: errorLine,
        startColumn: markerColumn,
        endLineNumber: errorLine,
        endColumn: markerColumn + 1,
        message: primaryMessage,
        severity: monaco.MarkerSeverity.Error,
      },
    ]);

    decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, [
      {
        range: new monaco.Range(errorLine, 1, errorLine, 1),
        options: {
          isWholeLine: true,
          className: "jscad-error-line-highlight",
          glyphMarginClassName: "jscad-error-line-glyph",
        },
      },
    ]);

    editor.revealLineInCenterIfOutsideViewport(errorLine);
  }, [error, errorColumn, errorLine, primaryMessage]);

  useEffect(() => {
    updateErrorMarker();
  }, [updateErrorMarker]);

  useEffect(() => {
    setIsStackExpanded(false);
  }, [error]);

  useImperativeHandle(ref, () => ({
    format: () => {
      editorRef.current?.getAction("editor.action.formatDocument")?.run();
    },
  }));

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (value !== undefined) {
        onChange(value);
      }
    },
    [onChange]
  );

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    updateErrorMarker();
  };

  const { resolvedTheme } = useTheme();
  const monacoTheme = resolvedTheme === "dark" ? "vs-dark" : "vs";

  return (
    <div className={`flex flex-col h-full bg-card ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Code2 className="w-4 h-4 text-emerald-500" />
        <h2 className="text-sm font-medium text-foreground">JSCAD Code</h2>
        {readOnly && (
          <span className="text-xs text-muted-foreground ml-auto">Read Only</span>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="px-4 py-2 bg-red-500/10 dark:bg-red-950/50 border-b border-red-500/30 dark:border-red-900/50">
          <div className="flex items-start gap-2">
            {hasStack ? (
              <button
                type="button"
                onClick={() => setIsStackExpanded((value) => !value)}
                className="mt-[1px] text-red-700/80 dark:text-red-300/80 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                aria-label={isStackExpanded ? "Collapse stack trace" : "Expand stack trace"}
              >
                <ChevronRight className={`w-3.5 h-3.5 transition-transform ${isStackExpanded ? "rotate-90" : "rotate-0"}`} />
              </button>
            ) : (
              <span className="w-3.5 h-3.5" aria-hidden />
            )}

            <div className="min-w-0">
              <div className="text-xs text-red-600 dark:text-red-400 font-mono break-words">
                {primaryMessage}
              </div>
              {errorLine && (
                <div className="text-[11px] text-red-700/80 dark:text-red-300/80 font-mono mt-0.5">
                  Line {errorLine}{errorColumn ? `:${errorColumn}` : ""}
                </div>
              )}
            </div>
          </div>

          {hasStack && isStackExpanded && (
            <pre className="mt-2 text-[11px] leading-5 text-red-700 dark:text-red-300 font-mono whitespace-pre-wrap break-words max-h-40 overflow-auto">
              {stackText}
            </pre>
          )}
        </div>
      )}

      {/* Monaco Editor */}
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          defaultLanguage="javascript"
          value={code}
          onChange={handleEditorChange}
          onMount={handleEditorDidMount}
          theme={monacoTheme}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: "var(--font-geist-mono), monospace",
            lineNumbers: "on",
            tabSize: 2,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: "on",
            readOnly,
            padding: { top: 12 },
            bracketPairColorization: { enabled: true },
              guides: {
                bracketPairs: true,
                indentation: true,
              },
              glyphMargin: true,
            }}
        />
      </div>
    </div>
  );
});

CodeEditor.displayName = "CodeEditor";
