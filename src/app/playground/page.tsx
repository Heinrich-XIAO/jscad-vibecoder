"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useJscadWorker, type JscadExecutionError } from "@/lib/jscad-worker";
import { extractParameters, type ExtractedParameter } from "@/lib/parameter-extractor";
import { Viewport3D } from "@/components/viewport-3d";
import { Box, Play, Download, Settings, Code, Camera } from "lucide-react";

interface ParameterValues {
  [key: string]: number | boolean | string;
}

const GUEST_STARTER_CODE = `function main() {
  return linkage(
    { initial: coord(0, 0, 0), final: coord(4, 0, 0) },
    { initial: coord(10, 0, 0, 0, 0, 0), final: coord(10, 0, 0, 0, 0, 50) }
  )
}

module.exports = { main }
`;

export default function PlaygroundPage() {
  const { execute } = useJscadWorker();
  
  const [code, setCode] = useState<string>(GUEST_STARTER_CODE);
  const [parameters, setParameters] = useState<ParameterValues>({});
  const [parameterDefs, setParameterDefs] = useState<ExtractedParameter[]>([]);
  const [geometry, setGeometry] = useState<unknown[]>([]);
  const [error, setError] = useState<JscadExecutionError | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (code) {
      const defs = extractParameters(code);
      setParameterDefs(defs);
      
      const defaults: ParameterValues = {};
      defs.forEach((def) => {
        defaults[def.name] = (def.initial ?? def.value) as number | boolean | string;
      });
      setParameters((prev) => ({ ...defaults, ...prev }));
    }
  }, [code]);

  const executeCode = useCallback(async () => {
    if (!code) return;
    
    setIsGenerating(true);
    setError(null);
    
    try {
      const result = await execute(code, parameters);
      
      if (result.error) {
        setError(result.error);
        setGeometry([]);
      } else if (result.geometry) {
        setGeometry(result.geometry);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? { message: err.message, stack: err.stack }
          : { message: "Unknown error" }
      );
      setGeometry([]);
    } finally {
      setIsGenerating(false);
    }
  }, [code, parameters, execute]);

  useEffect(() => {
    const timeout = setTimeout(executeCode, 800);
    return () => clearTimeout(timeout);
  }, [executeCode]);

  const handleRun = useCallback(() => {
    executeCode();
  }, [executeCode]);

  const handleCodeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCode(e.target.value);
  };

  const geometryCount = geometry.length;

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <Box className="h-5 w-5 text-primary" />
          <span className="font-semibold">Playground</span>
          <span className="text-xs text-muted-foreground">(no save)</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRun}
            disabled={isGenerating}
            className="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            Run
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex w-1/2 flex-col border-r border-border">
          <div className="flex h-8 shrink-0 items-center border-b border-border px-4">
            <Code className="mr-2 h-4 w-4" />
            <span className="text-sm font-medium">Code</span>
          </div>
          <textarea
            ref={textareaRef}
            value={code}
            onChange={handleCodeChange}
            className="flex-1 resize-none bg-background p-4 font-mono text-sm outline-none"
            spellCheck={false}
          />
        </div>

        <div className="flex w-1/2 flex-col">
          <div className="flex h-8 shrink-0 items-center border-b border-border px-4">
            <Box className="mr-2 h-4 w-4" />
            <span className="text-sm font-medium">3D Viewer</span>
            {geometryCount > 0 && (
              <span className="ml-2 text-xs text-muted-foreground">
                {geometryCount} objects
              </span>
            )}
          </div>
          <div className="relative flex-1">
            <Viewport3D
              geometry={geometry}
              isGenerating={isGenerating}
            />
            {error && (
              <div className="absolute bottom-4 left-4 right-4 rounded-lg bg-destructive/90 p-3 text-sm text-destructive-foreground">
                <details>
                  <summary className="cursor-pointer font-medium">Error</summary>
                  <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap">{error.message}</pre>
                </details>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
