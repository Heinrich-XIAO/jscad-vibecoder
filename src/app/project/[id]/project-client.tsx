"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useQuery, useMutation } from "convex/react";
import { ArrowLeft, Play, Save, Settings, Download, History, MessageSquare, Code, BarChart3, Undo2, Redo2 } from "lucide-react";
import { ChatPanel } from "@/components/chat-panel";
import { CodeEditor, type CodeEditorHandle } from "@/components/code-editor";
import { Viewport3D, type Viewport3DHandle } from "@/components/viewport-3d";
import { ParameterSliders, type ParameterSlidersHandle } from "@/components/parameter-sliders";
import { VersionHistory } from "@/components/version-history";
import { ExportDialog } from "@/components/export-dialog";
import { SettingsDialog } from "@/components/settings-dialog";
import { GeometryInfo } from "@/components/geometry-info";
import { KeyboardShortcutsDialog } from "@/components/keyboard-shortcuts-dialog";
import { extractParameters, type ExtractedParameter } from "@/lib/parameter-extractor";
import { useJscadWorker, type JscadExecutionError } from "@/lib/jscad-worker";
import { useKeyboardShortcuts, type KeyboardShortcut } from "@/lib/use-keyboard-shortcuts";
import { useUndoRedo } from "@/lib/use-undo-redo";
import { useAuth } from "@clerk/nextjs";

interface ParameterValues {
  [key: string]: number | boolean | string;
}

interface ProjectPageProps {
  id: string;
}

type PaneId = "chat" | "code" | "viewport";

const DEFAULT_PANE_ORDER: PaneId[] = ["chat", "code", "viewport"];

const DEFAULT_PANE_RATIOS: Record<PaneId, number> = {
  chat: 0.24,
  code: 0.46,
  viewport: 0.3,
};

const MIN_PANE_WIDTH: Record<PaneId, number> = {
  chat: 260,
  code: 420,
  viewport: 320,
};

function normalizeRatios(ids: PaneId[], ratios: Record<PaneId, number>) {
  const total = ids.reduce((sum, id) => sum + Math.max(0.01, ratios[id] ?? 0.01), 0);
  const normalized: Record<PaneId, number> = {
    chat: 0,
    code: 0,
    viewport: 0,
  };

  if (total <= 0) {
    const fallback = 1 / ids.length;
    ids.forEach((id) => {
      normalized[id] = fallback;
    });
    return normalized;
  }

  ids.forEach((id) => {
    normalized[id] = Math.max(0.01, ratios[id] ?? 0.01) / total;
  });

  return normalized;
}

function reorderVisiblePanes(
  paneOrder: PaneId[],
  visibleIds: PaneId[],
  fromIndex: number,
  toIndex: number
) {
  const orderedVisible = [...visibleIds];
  const [moved] = orderedVisible.splice(fromIndex, 1);
  orderedVisible.splice(toIndex, 0, moved);

  let visibleCursor = 0;
  return paneOrder.map((paneId) => {
    if (!visibleIds.includes(paneId)) return paneId;
    const next = orderedVisible[visibleCursor];
    visibleCursor += 1;
    return next;
  });
}

export default function ProjectPage({ id }: ProjectPageProps) {
  const router = useRouter();
  const { userId } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const focusChatParam = searchParams.get("focusChat") === "1";

  const projectQueryArgs = useMemo(() => {
    if (!id || !userId) return "skip";
    return { id: id as Id<"projects">, ownerId: userId };
  }, [id, userId]);

  const projectId = projectQueryArgs === "skip" ? null : projectQueryArgs.id;
  const versionsArgs = projectQueryArgs === "skip" ? "skip" : { projectId: projectQueryArgs.id, ownerId: projectQueryArgs.ownerId };
  const project = useQuery(api.projects.get, projectQueryArgs);
  const versions = useQuery(api.versions.list, versionsArgs);
  const createVersion = useMutation(api.versions.create);
  const saveDraft = useMutation(api.versions.saveDraft);

  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);
  const [parameters, setParameters] = useState<ParameterValues>({});
  const [parameterDefs, setParameterDefs] = useState<ExtractedParameter[]>([]);
  const [geometry, setGeometry] = useState<unknown[]>([]);
  const [error, setError] = useState<JscadExecutionError | null>(null);
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
  const [paneOrder, setPaneOrder] = useState<PaneId[]>(DEFAULT_PANE_ORDER);
  const [paneRatios, setPaneRatios] = useState<Record<PaneId, number>>(DEFAULT_PANE_RATIOS);
  const [activePane, setActivePane] = useState<PaneId>("code");
  const [draggingPane, setDraggingPane] = useState<PaneId | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const hasAutoFocusedChatRef = useRef(false);
  const viewportRef = useRef<Viewport3DHandle>(null);
  const editorRef = useRef<CodeEditorHandle>(null);
  const parametersRef = useRef<ParameterSlidersHandle>(null);
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistedCodeRef = useRef("");
  const layoutRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{
    leftId: PaneId;
    rightId: PaneId;
    startX: number;
    startLeftRatio: number;
    startRightRatio: number;
    containerWidth: number;
  } | null>(null);

  const { execute } = useJscadWorker();

  const isChatVisible = showChat && !!projectId && !!userId;

  const visiblePaneIds = useMemo(() => {
    return paneOrder.filter((id) => {
      if (id === "chat") return isChatVisible;
      return true;
    });
  }, [isChatVisible, paneOrder]);

  const visiblePaneRatios = useMemo(() => {
    return normalizeRatios(visiblePaneIds, paneRatios);
  }, [paneRatios, visiblePaneIds]);

  useEffect(() => {
    if (project && !code && project.currentVersion?.jscadCode) {
      resetCode(project.currentVersion.jscadCode);
      lastPersistedCodeRef.current = project.currentVersion.jscadCode;
    }
  }, [project, code, resetCode]);

  useEffect(() => {
    if (!focusChatParam || !projectId || hasAutoFocusedChatRef.current) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const tryFocus = () => {
      attempts += 1;
      const textarea = chatInputRef.current;
      if (textarea) {
        textarea.focus();
        hasAutoFocusedChatRef.current = true;
        router.replace(pathname);
        return;
      }
      if (attempts < 5) {
        timer = setTimeout(tryFocus, 60);
      }
    };

    tryFocus();

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [focusChatParam, projectId, pathname, router]);

  useEffect(() => {
    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
      }
    };
  }, []);

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
    const timeout = setTimeout(executeCode, 500);
    return () => clearTimeout(timeout);
  }, [executeCode]);

  const handleSaveVersion = useCallback(async () => {
    if (!code || !projectId || !userId) return;
    
    try {
      const versionId = await createVersion({
        projectId,
        jscadCode: code,
        source: "manual",
        isValid: true,
        ownerId: userId,
      });
      setCurrentVersionId(versionId);
      lastPersistedCodeRef.current = code;
    } catch (err) {
      console.error("Failed to save version:", err);
    }
  }, [code, createVersion, projectId, userId]);

  const getActiveVersionId = useCallback(() => {
    if (currentVersionId) return currentVersionId as Id<"versions">;
    if (project?.currentVersionId) return project.currentVersionId as Id<"versions">;
    return null;
  }, [currentVersionId, project]);

  const autosaveDraft = useCallback(async () => {
    if (!code || !userId) return;

    if (code === lastPersistedCodeRef.current) {
      return;
    }

    const activeVersionId = getActiveVersionId();
    if (!activeVersionId) {
      return;
    }

    try {
      await saveDraft({
        id: activeVersionId,
        jscadCode: code,
        ownerId: userId,
      });
      lastPersistedCodeRef.current = code;
    } catch (err) {
      console.error("Failed to autosave draft:", err);
    }
  }, [code, getActiveVersionId, saveDraft, userId]);

  const scheduleAutosaveDraft = useCallback((delayMs: number) => {
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
    }

    autosaveTimeoutRef.current = setTimeout(() => {
      void autosaveDraft();
    }, delayMs);
  }, [autosaveDraft]);

  const handleLoadVersion = useCallback((versionCode: string, versionId: string) => {
    setCode(versionCode);
    setCurrentVersionId(versionId);
    lastPersistedCodeRef.current = versionCode;
  }, [setCode]);

  const handleSelectVersion = useCallback((offset: number) => {
    if (!versions || versions.length === 0) return;
    
    // versions are likely sorted by creation time (descending)
    // Find current index
    const currentIndex = currentVersionId 
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? versions.findIndex((v: any) => v._id === currentVersionId)
      : 0; 
    
    if (currentIndex === -1) return;
    
    const newIndex = currentIndex + offset;
    
    if (newIndex >= 0 && newIndex < versions.length) {
      const v = versions[newIndex];
      handleLoadVersion(v.jscadCode, v._id);
    }
  }, [versions, currentVersionId, handleLoadVersion]);

  const handleParameterChange = (name: string, value: number | boolean | string) => {
    setParameters((prev) => ({ ...prev, [name]: value }));
  };

  const handleResetParameters = useCallback(() => {
    const defaults: ParameterValues = {};
    parameterDefs.forEach((def) => {
      defaults[def.name] = (def.initial ?? def.value) as number | boolean | string;
    });
    setParameters(defaults);
  }, [parameterDefs]);

  const handleResetParameter = useCallback((name: string) => {
    const def = parameterDefs.find((d) => d.name === name);
    if (def) {
      setParameters((prev) => ({
        ...prev,
        [name]: (def.initial ?? def.value) as number | boolean | string,
      }));
    }
  }, [parameterDefs]);

  const handleCodeChange = (newCode: string) => {
    setCode(newCode);
  };

  const handleRun = useCallback(async () => {
    await executeCode();
    scheduleAutosaveDraft(5000);
  }, [executeCode, scheduleAutosaveDraft]);

  const handlePromptComplete = useCallback(() => {
    void autosaveDraft();
  }, [autosaveDraft]);

  useEffect(() => {
    if (!visiblePaneIds.includes(activePane) && visiblePaneIds.length > 0) {
      setActivePane(visiblePaneIds[0]);
    }
  }, [activePane, visiblePaneIds]);

  const handlePaneDragStart = useCallback((paneId: PaneId, event: React.DragEvent<HTMLDivElement>) => {
    if (visiblePaneIds.length < 2) {
      event.preventDefault();
      return;
    }
    setDraggingPane(paneId);
    setDropIndex(visiblePaneIds.indexOf(paneId));
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", paneId);
  }, [visiblePaneIds]);

  const handlePaneDragOver = useCallback((event: React.DragEvent<HTMLDivElement>, index: number) => {
    if (!draggingPane) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;
    const next = event.clientX < midpoint ? index : index + 1;
    if (next !== dropIndex) {
      setDropIndex(next);
    }
  }, [draggingPane, dropIndex]);

  const clearPaneDrag = useCallback(() => {
    setDraggingPane(null);
    setDropIndex(null);
  }, []);

  const handlePaneDrop = useCallback((event: React.DragEvent<HTMLDivElement>, targetIndex: number) => {
    if (!draggingPane) return;
    event.preventDefault();

    const sourceIndex = visiblePaneIds.indexOf(draggingPane);
    if (sourceIndex === -1) {
      clearPaneDrag();
      return;
    }

    const clampedTarget = Math.max(0, Math.min(targetIndex, visiblePaneIds.length));
    const destinationIndex = clampedTarget > sourceIndex ? clampedTarget - 1 : clampedTarget;

    if (destinationIndex !== sourceIndex) {
      setPaneOrder((current) => reorderVisiblePanes(current, visiblePaneIds, sourceIndex, destinationIndex));
    }

    clearPaneDrag();
  }, [clearPaneDrag, draggingPane, visiblePaneIds]);

  const handleSplitterMouseDown = useCallback((leftId: PaneId, rightId: PaneId, event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const containerWidth = layoutRef.current?.clientWidth ?? 0;
    if (containerWidth <= 0) return;

    resizeRef.current = {
      leftId,
      rightId,
      startX: event.clientX,
      startLeftRatio: visiblePaneRatios[leftId] ?? 0,
      startRightRatio: visiblePaneRatios[rightId] ?? 0,
      containerWidth,
    };
    setIsResizing(true);
  }, [visiblePaneRatios]);

  useEffect(() => {
    if (!isResizing) return;

    const handlePointerMove = (event: PointerEvent) => {
      const activeResize = resizeRef.current;
      if (!activeResize) return;

      const deltaRatio = (event.clientX - activeResize.startX) / activeResize.containerWidth;
      const pairTotal = activeResize.startLeftRatio + activeResize.startRightRatio;
      const leftMin = MIN_PANE_WIDTH[activeResize.leftId] / activeResize.containerWidth;
      const rightMin = MIN_PANE_WIDTH[activeResize.rightId] / activeResize.containerWidth;

      let nextLeft: number;
      let nextRight: number;

      if (pairTotal <= leftMin + rightMin) {
        const leftShare = leftMin / (leftMin + rightMin);
        nextLeft = pairTotal * leftShare;
        nextRight = pairTotal - nextLeft;
      } else {
        nextLeft = Math.max(leftMin, Math.min(pairTotal - rightMin, activeResize.startLeftRatio + deltaRatio));
        nextRight = pairTotal - nextLeft;
      }

      setPaneRatios((current) => {
        const normalized = normalizeRatios(visiblePaneIds, current);
        normalized[activeResize.leftId] = nextLeft;
        normalized[activeResize.rightId] = nextRight;
        return {
          ...current,
          ...normalized,
        };
      });
    };

    const handlePointerUp = () => {
      resizeRef.current = null;
      setIsResizing(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isResizing, visiblePaneIds]);

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
        handler: () => {
          void handleRun();
        },
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
        handler: () => {
          setShowChat((v) => {
            const next = !v;
            if (next) setActivePane("chat");
            return next;
          });
        },
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
          setActivePane("chat");
          // Focus the chat input after a tick so it's rendered
          setTimeout(() => chatInputRef.current?.focus(), 50);
        },
        description: "Focus chat input",
        group: "Panels",
      },
      {
        key: "p",
        handler: () => parametersRef.current?.focusFirst(),
        description: "Focus parameters",
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
        key: "ArrowUp",
        alt: true,
        handler: () => handleSelectVersion(-1),
        description: "Previous Version",
        group: "Navigation",
      },
      {
        key: "ArrowDown",
        alt: true,
        handler: () => handleSelectVersion(1),
        description: "Next Version",
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
      handleRun,
      undoCode,
      redoCode,
      showChat,
      setActivePane,
      showExport,
      showSettings,
      showVersions,
      showShortcuts,
      handleSelectVersion,
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

  const paneTitles: Record<PaneId, string> = {
    chat: "Chat",
    code: "Code",
    viewport: "Viewport",
  };

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
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
            onClick={() => {
              const next = !showChat;
              setShowChat(next);
              if (next) setActivePane("chat");
            }}
            className={`p-2 rounded-lg transition-colors ${showChat ? "bg-primary/20 text-primary" : "hover:bg-secondary"}`}
            title="Toggle Chat (Ctrl+/)"
          >
            <MessageSquare className="w-5 h-5" />
          </button>
          <div className="w-px h-6 bg-border mx-1" />
          <button
            onClick={() => {
              void handleRun();
            }}
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
            onClick={() => setShowSettings(true)}
            className="p-2 hover:bg-secondary rounded-lg transition-colors"
            title="Settings (Ctrl+,)"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div
        ref={layoutRef}
        className={`flex-1 flex overflow-hidden ${isResizing ? "cursor-col-resize select-none" : ""}`}
      >
        {visiblePaneIds.map((paneId, index) => {
          const ratio = Math.max(0.01, visiblePaneRatios[paneId] ?? 0.01);
          const isActive = activePane === paneId;
          const showDropLeft = draggingPane !== null && dropIndex === index;
          const showDropRight = draggingPane !== null && dropIndex === index + 1;

          return (
            <div key={paneId} className="contents">
              <div
                className={`relative min-w-0 flex flex-col bg-card border-border ${index > 0 ? "border-l" : ""} ${isActive ? "ring-1 ring-primary/30" : ""}`}
                style={{ flexBasis: 0, flexGrow: ratio, flexShrink: 1 }}
                onClick={() => setActivePane(paneId)}
                onDragOver={(event) => handlePaneDragOver(event, index)}
                onDrop={(event) => handlePaneDrop(event, dropIndex ?? index)}
              >
                {showDropLeft && (
                  <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-primary/70 pointer-events-none z-20" />
                )}
                {showDropRight && (
                  <div className="absolute right-0 top-0 bottom-0 w-1.5 bg-primary/70 pointer-events-none z-20" />
                )}

                <div
                  draggable={visiblePaneIds.length > 1}
                  onDragStart={(event) => handlePaneDragStart(paneId, event)}
                  onDragEnd={clearPaneDrag}
                  className="h-9 px-3 border-b border-border flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground cursor-move"
                >
                  <span>{paneTitles[paneId]}</span>
                  <span className="text-[10px] opacity-70">drag</span>
                </div>

                {paneId === "chat" && projectId && userId && (
                  <div className="flex-1 min-h-0">
                    <ChatPanel
                      projectId={projectId}
                      projectName={project?.name}
                      currentCode={code}
                      onCodeChange={handleCodeChange}
                      onPromptComplete={handlePromptComplete}
                      inputRef={chatInputRef}
                      ownerId={userId}
                    />
                  </div>
                )}

                {paneId === "code" && (
                  <div className="flex-1 min-h-0">
                    <CodeEditor
                      code={code}
                      onChange={handleCodeChange}
                      error={error}
                      ref={editorRef}
                    />
                  </div>
                )}

                {paneId === "viewport" && (
                  <div className="flex-1 min-h-0 flex flex-col">
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
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-sm font-medium flex items-center gap-2">
                            <Code className="w-4 h-4" />
                            Parameters
                          </h3>
                          <button
                            onClick={handleResetParameters}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                            title="Reset to defaults"
                          >
                            Reset
                          </button>
                        </div>
                        <ParameterSliders
                          parameters={parameterDefs}
                          values={parameters}
                          onChange={handleParameterChange}
                          onReset={handleResetParameter}
                          ref={parametersRef}
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
                )}
              </div>

              {index < visiblePaneIds.length - 1 && (
                <div
                  className="w-1.5 bg-border/80 hover:bg-primary/40 transition-colors cursor-col-resize"
                  onMouseDown={(event) => handleSplitterMouseDown(paneId, visiblePaneIds[index + 1], event)}
                />
              )}
            </div>
          );
        })}
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
