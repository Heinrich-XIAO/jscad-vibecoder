"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { useQuery, useMutation } from "convex/react";
import { ArrowLeft, Play, Save, Settings, Download, History, MessageSquare, Code, BarChart3, Keyboard, Undo2, Redo2 } from "lucide-react";
import { ChatPanel } from "@/components/chat-panel";
import { CodeEditor, type CodeEditorHandle } from "@/components/code-editor";
import { Viewport3D, type Viewport3DHandle } from "@/components/viewport-3d";
import { ParameterSliders } from "@/components/parameter-sliders";
import { VersionHistory } from "@/components/version-history";
import { ExportDialog } from "@/components/export-dialog";
import { SettingsDialog } from "@/components/settings-dialog";
import { GeometryInfo } from "@/components/geometry-info";
import { KeyboardShortcutsDialog } from "@/components/keyboard-shortcuts-dialog";
import { CollaborationIndicator } from "@/components/collaboration-indicator";
import { extractParameters, type ExtractedParameter } from "@/lib/parameter-extractor";
import { useJscadWorker } from "@/lib/jscad-worker";
import { useKeyboardShortcuts, type KeyboardShortcut } from "@/lib/use-keyboard-shortcuts";
import { useUndoRedo } from "@/lib/use-undo-redo";

interface ParameterValues {
  [key: string]: number | boolean | string;
}

interface ProjectPageProps {
  id: string;
}

export default function ProjectPage({ id }: ProjectPageProps) {
  const router = useRouter();
  const projectId = id;

  const project = useQuery(api.projects.get, { id: projectId });
  const versions = useQuery(api.versions.list, { projectId });
  const updateProject = useMutation(api.projects.update);
  const createVersion = useMutation(api.versions.create);

  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  const [parameters, setParameters] = useState<ParameterValues>({});
  const [parameterDefs, setParameterDefs] = useState<ExtractedParameter[]>([]);
  const [geometry, setGeometry] = useState<unknown[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Undo/redo for code editor
  const {
    state: code,
    setState: setCode,
    undo: undoCode,
    redo: redoCode,
    canUndo,
    canRedo,
    reset: resetCode,
  } = useUndoRedo<string>("", 50);
  
  const [showChat, setShowChat] = useState(true);
  const [showVersions, setShowVersions] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showGeometryInfo, setShowGeometryInfo] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const viewportRef = useRef<Viewport3DHandle>(null);
  const editorRef = useRef<CodeEditorHandle>(null);

  const { execute } = useJscadWorker();

  useEffect(() => {
    if (project && !code) {
      resetCode(project.currentCode);
    }
  }, [project, code, resetCode]);

  useEffect(() => {
    if (code) {
      const defs = extractParameters(code);
      setParameterDefs(defs);
      
      const defaults: ParameterValues = {};
      defs.forEach((def) => {
        defaults[def.name] = def.initial as number | boolean | string;
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
      setError(err instanceof Error ? err.message : "Unknown error");
      setGeometry([]);
    } finally {
      setIsGenerating(false);
    }
  }, [code, parameters, execute]);

  useEffect(() => {
    const timeout = setTimeout(executeCode, 500);
    return () => clearTimeout(timeout);
  }, [executeCode]);

  const handleSaveVersion = useCallback(async () => {
    if (!code) return;
    
    try {
      const versionId = await createVersion({
        projectId,
        jscadCode: code,
        source: "manual",
        isValid: true,
      });
      setCurrentVersionId(versionId);
      
      await updateProject({
        id: projectId,
        currentCode: code,
      });
    } catch (err) {
      console.error("Failed to save version:", err);
    }
  }, [code, createVersion, projectId, updateProject]);

  const handleLoadVersion = (versionCode: string, versionId: string) => {
    setCode(versionCode);
    setCurrentVersionId(versionId);
  };

  const handleParameterChange = (name: string, value: number | boolean | string) => {
    setParameters((prev) => ({ ...prev, [name]: value }));
  };

  const handleCodeChange = (newCode: string) => {
    setCode(newCode);
  };

  // Keyboard shortcuts - must be defined after all handler functions
  const shortcuts: KeyboardShortcut[] = useMemo(
    () => [
      // --- File operations ---
      {
        key: "s",
        ctrl: true,
        handler: handleSaveVersion,
        description: "Save version",
        group: "File",
      },
      {
        key: "e",
        ctrl: true,
        handler: () => setShowExport(true),
        description: "Export model",
        group: "File",
      },
      {
        key: "Enter",
        ctrl: true,
        handler: executeCode,
        description: "Run code",
        group: "File",
      },
      // --- Edit ---
      {
        key: "z",
        ctrl: true,
        handler: undoCode,
        description: "Undo",
        group: "Edit",
      },
      {
        key: "y",
        ctrl: true,
        handler: redoCode,
        description: "Redo",
        group: "Edit",
      },
      {
        key: "z",
        ctrl: true,
        shift: true,
        handler: redoCode,
        description: "Redo (alt)",
        group: "Edit",
      },
      {
        key: "f",
        shift: true,
        alt: true,
        handler: () => editorRef.current?.format(),
        description: "Format Code",
        group: "Edit",
      },
      // --- View ---
      {
        key: "ArrowUp",
        handler: () => viewportRef.current?.rotate(-10, 0),
        description: "Rotate Up",
        group: "View",
      },
      {
        key: "ArrowDown",
        handler: () => viewportRef.current?.rotate(10, 0),
        description: "Rotate Down",
        group: "View",
      },
      {
        key: "ArrowLeft",
        handler: () => viewportRef.current?.rotate(0, -10),
        description: "Rotate Left",
        group: "View",
      },
      {
        key: "ArrowRight",
        handler: () => viewportRef.current?.rotate(0, 10),
        description: "Rotate Right",
        group: "View",
      },
      {
        key: "+",
        handler: () => viewportRef.current?.zoomIn(),
        description: "Zoom In",
        group: "View",
      },
      {
        key: "=",
        handler: () => viewportRef.current?.zoomIn(),
        description: "Zoom In",
        group: "View",
      },
      {
        key: "-",
        handler: () => viewportRef.current?.zoomOut(),
        description: "Zoom Out",
        group: "View",
      },
      {
        key: "r",
        handler: () => viewportRef.current?.reset(),
        description: "Reset View",
        group: "View",
      },
      // --- Panels ---
      {
        key: "/",
        ctrl: true,
        handler: () => setShowChat((v) => !v),
        description: "Toggle chat",
        group: "Panels",
      },
      {
        key: "h",
        ctrl: true,
        handler: () => setShowVersions((v) => !v),
        description: "Toggle version history",
        group: "Panels",
      },
      {
        key: "i",
        ctrl: true,
        handler: () => setShowGeometryInfo((v) => !v),
        description: "Toggle geometry info",
        group: "Panels",
      },
      {
        key: "j",
        ctrl: true,
        handler: () => {
          if (!showChat) setShowChat(true);
          // Focus the chat input after a tick so it's rendered
          setTimeout(() => chatInputRef.current?.focus(), 50);
        },
        description: "Focus chat input",
        group: "Panels",
      },
      // --- Navigation / dialogs ---
      {
        key: ",",
        ctrl: true,
        handler: () => setShowSettings(true),
        description: "Open settings",
        group: "Navigation",
      },
      {
        key: "Escape",
        handler: () => {
          if (showShortcuts) setShowShortcuts(false);
          else if (showExport) setShowExport(false);
          else if (showSettings) setShowSettings(false);
          else if (showVersions) setShowVersions(false);
        },
        description: "Close dialogs",
        group: "Navigation",
        alwaysEnabled: true,
      },
      {
        key: "?",
        shift: true,
        handler: () => setShowShortcuts((v) => !v),
        description: "Show keyboard shortcuts",
        group: "Navigation",
      },
    ],
    [
      handleSaveVersion,
      executeCode,
      undoCode,
      redoCode,
      showChat,
      showExport,
      showSettings,
      showVersions,
      showShortcuts,
    ]
  );

  useKeyboardShortcuts(shortcuts);

  if (!project) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading project...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-4 py-3 flex items-center justify-between bg-card">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/")}
            className="p-2 hover:bg-secondary rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="font-semibold text-lg">{project.name}</h1>
            <div className="flex items-center gap-3">
              <p className="text-xs text-muted-foreground">
                {versions?.length || 0} versions
              </p>
              <CollaborationIndicator projectId={projectId} />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowVersions(!showVersions)}
            className={`p-2 rounded-lg transition-colors ${showVersions ? "bg-primary/20 text-primary" : "hover:bg-secondary"}`}
            title="Version History (Ctrl+H)"
          >
            <History className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowGeometryInfo(!showGeometryInfo)}
            className={`p-2 rounded-lg transition-colors ${showGeometryInfo ? "bg-primary/20 text-primary" : "hover:bg-secondary"}`}
            title="Geometry Info (Ctrl+I)"
          >
            <BarChart3 className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowChat(!showChat)}
            className={`p-2 rounded-lg transition-colors ${showChat ? "bg-primary/20 text-primary" : "hover:bg-secondary"}`}
            title="Toggle Chat (Ctrl+/)"
          >
            <MessageSquare className="w-5 h-5" />
          </button>
          <div className="w-px h-6 bg-border mx-1" />
          <button
            onClick={executeCode}
            disabled={isGenerating}
            className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary/90 disabled:opacity-50"
            title="Run Code (Ctrl+Enter)"
          >
            <Play className="w-4 h-4" />
            {isGenerating ? "Running..." : "Run"}
          </button>
          <button
            onClick={handleSaveVersion}
            className="flex items-center gap-2 px-3 py-1.5 bg-secondary text-secondary-foreground rounded-lg text-sm hover:bg-secondary/80"
            title="Save Version (Ctrl+S)"
          >
            <Save className="w-4 h-4" />
            Save
          </button>
          <button
            onClick={() => setShowExport(true)}
            className="flex items-center gap-2 px-3 py-1.5 border border-border rounded-lg text-sm hover:bg-secondary"
            title="Export Model (Ctrl+E)"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
          <div className="w-px h-6 bg-border mx-1" />
          <button
            onClick={undoCode}
            disabled={!canUndo}
            className="p-2 hover:bg-secondary rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            onClick={redoCode}
            disabled={!canRedo}
            className="p-2 hover:bg-secondary rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Redo (Ctrl+Y)"
          >
            <Redo2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowShortcuts(true)}
            className="p-2 hover:bg-secondary rounded-lg transition-colors"
            title="Keyboard Shortcuts (?)"
          >
            <Keyboard className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 hover:bg-secondary rounded-lg transition-colors"
            title="Settings (Ctrl+,)"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {showChat && (
          <div className="w-80 border-r border-border flex flex-col bg-card">
            <ChatPanel
              projectId={projectId}
              currentCode={code}
              onCodeChange={handleCodeChange}
              inputRef={chatInputRef}
            />
          </div>
        )}

        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 relative">
            <CodeEditor
              code={code}
              onChange={handleCodeChange}
              error={error}
              ref={editorRef}
            />
          </div>
        </div>

        <div className="w-96 border-l border-border flex flex-col bg-card">
          <div className="flex-1 min-h-0">
            <Viewport3D
              geometry={geometry}
              isGenerating={isGenerating}
              ref={viewportRef}
            />
          </div>

          {showGeometryInfo && (
            <div className="border-t border-border p-4 max-h-80 overflow-y-auto">
              <GeometryInfo geometry={geometry} />
            </div>
          )}

          {parameterDefs.length > 0 && (
            <div className="border-t border-border p-4 max-h-48 overflow-y-auto">
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <Code className="w-4 h-4" />
                Parameters
              </h3>
              <ParameterSliders
                parameters={parameterDefs}
                values={parameters}
                onChange={handleParameterChange}
              />
            </div>
          )}

          {showVersions && versions && (
            <div className="border-t border-border p-4 max-h-64 overflow-y-auto">
              <VersionHistory
                versions={versions}
                currentVersionId={currentVersionId}
                onLoadVersion={handleLoadVersion}
              />
            </div>
          )}
        </div>
      </div>

      <ExportDialog
        isOpen={showExport}
        onClose={() => setShowExport(false)}
        geometry={geometry}
        projectName={project.name}
      />
      <SettingsDialog
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
      <KeyboardShortcutsDialog
        isOpen={showShortcuts}
        onClose={() => setShowShortcuts(false)}
        shortcuts={shortcuts}
      />
    </div>
  );
}