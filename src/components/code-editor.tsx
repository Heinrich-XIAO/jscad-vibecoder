"use client";

import { useCallback, useRef, useImperativeHandle, forwardRef } from "react";
import { useTheme } from "@/lib/theme-provider";
import Editor, { type OnMount } from "@monaco-editor/react";
import { Code2 } from "lucide-react";

export interface CodeEditorHandle {
  format: () => void;
}

interface CodeEditorProps {
  code: string;
  onChange: (code: string) => void;
  readOnly?: boolean;
  error?: string | null;
  className?: string;
}

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(({
  code,
  onChange,
  readOnly = false,
  error,
  className = "",
}, ref) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);

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

  const handleEditorDidMount: OnMount = (editor) => {
    editorRef.current = editor;
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
          <div className="text-xs text-red-600 dark:text-red-400 font-mono">
            {error}
          </div>
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
          }}
        />
      </div>
    </div>
  );
});

CodeEditor.displayName = "CodeEditor";
