"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useQuery, useMutation } from "convex/react";
import { ArrowLeft, Play, Save, Settings, Download, History, MessageSquare, Code, BarChart3, Box, Camera, RotateCcw, SlidersHorizontal } from "lucide-react";
import { ChatPanel, type ChatPanelHandle } from "@/components/chat-panel";
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
import { useAuth } from "@/lib/auth-client";

interface ParameterValues {
  [key: string]: number | boolean | string;
}

interface ProjectPageProps {
  id: string;
}

type PaneId = "chat" | "code" | "viewport";
type LayoutMode = "columns" | "rows" | "leftStack" | "rightStack";
type DropZone = "left" | "right" | "top" | "bottom" | "center";

const DEFAULT_PANE_ORDER: PaneId[] = ["chat", "code", "viewport"];

const DEFAULT_PANE_RATIOS: Record<PaneId, number> = {
  chat: 0.33,
  code: 0.33,
  viewport: 0.34,
};

const MIN_PANE_WIDTH: Record<PaneId, number> = {
  chat: 260,
  code: 420,
  viewport: 320,
};

const MIN_PANE_HEIGHT: Record<PaneId, number> = {
  chat: 200,
  code: 240,
  viewport: 220,
};

const GUEST_STARTER_CODE = `const { cuboid } = require('@jscad/modeling').primitives

function main() {
  return [cuboid({ size: [20, 20, 20] })]
}

module.exports = { main }
`;

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

function withoutPane(ids: PaneId[], paneId: PaneId) {
  return ids.filter((id) => id !== paneId);
}

function insertAroundTarget(
  ids: PaneId[],
  source: PaneId,
  target: PaneId,
  side: "left" | "right"
) {
  const base = withoutPane(ids, source);
  const targetIndex = base.indexOf(target);
  if (targetIndex === -1) return base;
  const insertIndex = side === "left" ? targetIndex : targetIndex + 1;
  const next = [...base];
  next.splice(insertIndex, 0, source);
  return next;
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
  const [isSnapshotting, setIsSnapshotting] = useState(false);
  
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
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("leftStack");
  const [stackPrimaryRatio, setStackPrimaryRatio] = useState(0.33);
  const [stackSecondaryRatio, setStackSecondaryRatio] = useState(0.5);
  const [activePane, setActivePane] = useState<PaneId>("code");
  const [draggingPane, setDraggingPane] = useState<PaneId | null>(null);
  const [dropTarget, setDropTarget] = useState<{ paneId: PaneId; zone: DropZone } | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [layoutWidth, setLayoutWidth] = useState(0);
  const chatPanelRef = useRef<ChatPanelHandle>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const hasAutoFocusedChatRef = useRef(false);
  const viewportRef = useRef<Viewport3DHandle>(null);
  const editorRef = useRef<CodeEditorHandle>(null);
  const parametersRef = useRef<ParameterSlidersHandle>(null);
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistedCodeRef = useRef("");
  const hasLoadedInitialCodeRef = useRef(false);
  const layoutRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{
    axis: "x" | "y";
    kind: "pair" | "stackPrimary" | "stackSecondary";
    start: number;
    stackPrimarySide?: "left" | "right";
    leftId?: PaneId;
    rightId?: PaneId;
    topId?: PaneId;
    bottomId?: PaneId;
    startLeftRatio?: number;
    startRightRatio?: number;
    startTopRatio?: number;
    startBottomRatio?: number;
    startStackPrimaryRatio?: number;
    startStackSecondaryRatio?: number;
    containerSize: number;
  } | null>(null);
  const hasAutoCompactedInitialLayoutRef = useRef(false);

  const { execute } = useJscadWorker();
  const geometryCount = geometry.length;
  const isSignedIn = !!userId;

  const isChatVisible = showChat;

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
    if (hasLoadedInitialCodeRef.current) return;
    if (project && project.currentVersion?.jscadCode) {
      resetCode(project.currentVersion.jscadCode);
      lastPersistedCodeRef.current = project.currentVersion.jscadCode;
      hasLoadedInitialCodeRef.current = true;
    }
  }, [project, resetCode]);

  useEffect(() => {
    if (hasLoadedInitialCodeRef.current) return;
    if (isSignedIn || code) return;
    resetCode(GUEST_STARTER_CODE);
    lastPersistedCodeRef.current = GUEST_STARTER_CODE;
    hasLoadedInitialCodeRef.current = true;
  }, [code, isSignedIn, resetCode]);

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
    if (newCode.trim() === "" && code.trim() !== "") {
      return;
    }
    setCode(newCode);
  };

  const handleRun = useCallback(async () => {
    await executeCode();
    scheduleAutosaveDraft(5000);
  }, [executeCode, scheduleAutosaveDraft]);

  const handlePromptComplete = useCallback(() => {
    void autosaveDraft();
  }, [autosaveDraft]);

  const handleInsertViewportSnapshot = useCallback(() => {
    if (!viewportRef.current?.captureImage) {
      console.warn("Viewport renderer is not ready for capture yet.");
      return;
    }
    if (geometryCount === 0) {
      return;
    }
    setIsSnapshotting(true);
    try {
      const dataUrl = viewportRef.current.captureImage();
      if (!dataUrl) {
        console.warn("Viewport capture returned no data.");
        return;
      }
      const timestamp = new Date().toLocaleString();
      chatPanelRef.current?.addImageAttachment(dataUrl, `Viewport snapshot ${timestamp}`);
      if (!showChat) {
        setShowChat(true);
      }
      setActivePane("chat");
      chatPanelRef.current?.focusInput();
    } catch (error) {
      console.error("Failed to capture viewport snapshot", error);
    } finally {
      setIsSnapshotting(false);
    }
  }, [geometryCount, showChat]);

  const requestViewportSnapshot = useCallback(() => {
    if (!viewportRef.current?.captureImage || geometryCount === 0) {
      return null;
    }
    try {
      const url = viewportRef.current.captureImage();
      if (!url) return null;
      return {
        url,
        altText: "Current 3D viewport state",
      };
    } catch {
      return null;
    }
  }, [geometryCount]);

  const handleResetLayout = useCallback(() => {
    setPaneOrder(DEFAULT_PANE_ORDER);
    setPaneRatios(DEFAULT_PANE_RATIOS);
    setLayoutMode("leftStack");
    setStackPrimaryRatio(0.33);
    setStackSecondaryRatio(0.5);
    setActivePane("code");
  }, []);

  useEffect(() => {
    if (!visiblePaneIds.includes(activePane) && visiblePaneIds.length > 0) {
      setActivePane(visiblePaneIds[0]);
    }
  }, [activePane, visiblePaneIds]);

  useEffect(() => {
    if (visiblePaneIds.length < 3 && layoutMode !== "columns" && layoutMode !== "rows") {
      setLayoutMode("columns");
    }
  }, [layoutMode, visiblePaneIds.length]);

  useEffect(() => {
    const container = layoutRef.current;
    if (!container) return;

    const updateWidth = () => {
      setLayoutWidth(container.clientWidth);
    };

    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (hasAutoCompactedInitialLayoutRef.current) return;
    if (layoutMode !== "columns") return;
    if (visiblePaneIds.length !== 3) return;
    if (layoutWidth <= 0) return;

    const minColumnsWidth = visiblePaneIds.reduce((sum, paneId) => sum + MIN_PANE_WIDTH[paneId], 0) + 3;
    if (layoutWidth >= minColumnsWidth) return;

    hasAutoCompactedInitialLayoutRef.current = true;
    setLayoutMode("rightStack");
    setPaneOrder(["code", "viewport", "chat"]);
    setStackPrimaryRatio(0.62);
    setStackSecondaryRatio(0.5);
  }, [layoutMode, layoutWidth, visiblePaneIds]);

  const resolveDropZone = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const normX = rect.width > 0 ? x / rect.width : 0.5;
    const normY = rect.height > 0 ? y / rect.height : 0.5;

    const centerInset = 0.3;
    if (
      normX >= centerInset &&
      normX <= 1 - centerInset &&
      normY >= centerInset &&
      normY <= 1 - centerInset
    ) {
      return "center" as const;
    }

    const distances = [
      { zone: "left" as const, value: normX },
      { zone: "right" as const, value: 1 - normX },
      { zone: "top" as const, value: normY },
      { zone: "bottom" as const, value: 1 - normY },
    ];
    distances.sort((a, b) => a.value - b.value);
    return distances[0].zone;

  }, []);

  const handlePaneDragStart = useCallback((paneId: PaneId, event: React.DragEvent<HTMLDivElement>) => {
    if (visiblePaneIds.length < 2) {
      event.preventDefault();
      return;
    }
    setDraggingPane(paneId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-openmech-pane", paneId);
  }, [visiblePaneIds]);

  const handlePaneDragOver = useCallback((event: React.DragEvent<HTMLDivElement>, paneId: PaneId) => {
    if (!draggingPane) return;
    event.preventDefault();
    const zone = resolveDropZone(event);
    if (!dropTarget || dropTarget.paneId !== paneId || dropTarget.zone !== zone) {
      setDropTarget({ paneId, zone });
    }
  }, [draggingPane, dropTarget, resolveDropZone]);

  const clearPaneDrag = useCallback(() => {
    setDraggingPane(null);
    setDropTarget(null);
  }, []);

  const handlePaneDrop = useCallback((event: React.DragEvent<HTMLDivElement>, targetPane: PaneId) => {
    if (!draggingPane) return;
    event.preventDefault();
    const zone = resolveDropZone(event);

    if (draggingPane === targetPane) {
      clearPaneDrag();
      return;
    }

    if (zone === "center") {
      const sourceIndex = visiblePaneIds.indexOf(draggingPane);
      const targetIndex = visiblePaneIds.indexOf(targetPane);
      if (sourceIndex !== -1 && targetIndex !== -1 && sourceIndex !== targetIndex) {
        setPaneOrder((current) => reorderVisiblePanes(current, visiblePaneIds, sourceIndex, targetIndex));
      }
      clearPaneDrag();
      return;
    }

    if (zone === "left" || zone === "right") {
      setLayoutMode("columns");
      setPaneOrder((current) => {
        const visible = current.filter((id) => visiblePaneIds.includes(id));
        const reordered = insertAroundTarget(visible, draggingPane, targetPane, zone);
        let cursor = 0;
        return current.map((id) => {
          if (!visiblePaneIds.includes(id)) return id;
          const next = reordered[cursor];
          cursor += 1;
          return next;
        });
      });
      clearPaneDrag();
      return;
    }

    if (visiblePaneIds.length === 3) {
      const targetIndex = visiblePaneIds.indexOf(targetPane);
      const sourceIndex = visiblePaneIds.indexOf(draggingPane);
      const remaining = visiblePaneIds.find((id) => id !== draggingPane && id !== targetPane);

      if (targetIndex !== -1 && sourceIndex !== -1 && remaining) {
        const stackTop = zone === "top" ? draggingPane : targetPane;
        const stackBottom = zone === "top" ? targetPane : draggingPane;

        const nextLayoutMode: LayoutMode =
          targetIndex === 0
            ? "rightStack"
            : targetIndex === 2
              ? "leftStack"
              : sourceIndex > targetIndex
                ? "leftStack"
                : "rightStack";

        setLayoutMode(nextLayoutMode);
        if (nextLayoutMode === "rightStack") {
          setPaneOrder([stackTop, stackBottom, remaining]);
        } else {
          setPaneOrder([remaining, stackTop, stackBottom]);
        }
      }
    } else {
      setLayoutMode("rows");
      setPaneOrder((current) => {
        const visible = current.filter((id) => visiblePaneIds.includes(id));
        const reordered = insertAroundTarget(visible, draggingPane, targetPane, zone === "top" ? "left" : "right");
        let cursor = 0;
        return current.map((id) => {
          if (!visiblePaneIds.includes(id)) return id;
          const next = reordered[cursor];
          cursor += 1;
          return next;
        });
      });
    }

    clearPaneDrag();
  }, [clearPaneDrag, draggingPane, resolveDropZone, visiblePaneIds]);

  const handleRootDragOverCapture = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!draggingPane) return;
    event.preventDefault();
  }, [draggingPane]);

  const handleRootDropCapture = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!draggingPane) return;
    event.preventDefault();
    if (event.target === event.currentTarget) {
      clearPaneDrag();
    }
  }, [clearPaneDrag, draggingPane]);

  const startPairResize = useCallback((axis: "x" | "y", firstId: PaneId, secondId: PaneId, event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = layoutRef.current;
    if (!container) return;
    const containerSize = axis === "x" ? container.clientWidth : container.clientHeight;
    if (containerSize <= 0) return;

    const ratios = normalizeRatios(visiblePaneIds, paneRatios);
    resizeRef.current = {
      axis,
      kind: "pair",
      start: axis === "x" ? event.clientX : event.clientY,
      leftId: firstId,
      rightId: secondId,
      startLeftRatio: ratios[firstId] ?? 0,
      startRightRatio: ratios[secondId] ?? 0,
      containerSize,
    };
    setIsResizing(true);
  }, [paneRatios, visiblePaneIds]);

  const startStackPrimaryResize = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = layoutRef.current;
    if (!container) return;
    const containerSize = container.clientWidth;
    if (containerSize <= 0) return;
    resizeRef.current = {
      axis: "x",
      kind: "stackPrimary",
      start: event.clientX,
      stackPrimarySide: layoutMode === "rightStack" ? "right" : "left",
      startStackPrimaryRatio: stackPrimaryRatio,
      containerSize,
    };
    setIsResizing(true);
  }, [layoutMode, stackPrimaryRatio]);

  const startStackSecondaryResize = useCallback((topId: PaneId, bottomId: PaneId, event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = layoutRef.current;
    if (!container) return;
    const containerSize = container.clientHeight;
    if (containerSize <= 0) return;

    resizeRef.current = {
      axis: "y",
      kind: "stackSecondary",
      start: event.clientY,
      topId,
      bottomId,
      startStackSecondaryRatio: stackSecondaryRatio,
      containerSize,
    };
    setIsResizing(true);
  }, [stackSecondaryRatio]);

  useEffect(() => {
    if (!isResizing) return;

    const handlePointerMove = (event: PointerEvent) => {
      const activeResize = resizeRef.current;
      if (!activeResize) return;

      const currentPos = activeResize.axis === "x" ? event.clientX : event.clientY;
      const deltaRatio = (currentPos - activeResize.start) / activeResize.containerSize;

      if (activeResize.kind === "pair") {
        if (!activeResize.leftId || !activeResize.rightId) return;
        const leftId = activeResize.leftId;
        const rightId = activeResize.rightId;
        const startLeft = activeResize.startLeftRatio ?? 0;
        const startRight = activeResize.startRightRatio ?? 0;
        const pairTotal = startLeft + startRight;
        const minLeft = (activeResize.axis === "x" ? MIN_PANE_WIDTH[leftId] : MIN_PANE_HEIGHT[leftId]) / activeResize.containerSize;
        const minRight = (activeResize.axis === "x" ? MIN_PANE_WIDTH[rightId] : MIN_PANE_HEIGHT[rightId]) / activeResize.containerSize;
        const minTotal = minLeft + minRight;
        const minScale = minTotal > pairTotal && minTotal > 0 ? pairTotal / minTotal : 1;
        const effectiveMinLeft = minLeft * minScale;
        const effectiveMinRight = minRight * minScale;

        let nextLeft = startLeft + deltaRatio;
        nextLeft = Math.max(effectiveMinLeft, Math.min(pairTotal - effectiveMinRight, nextLeft));
        const nextRight = pairTotal - nextLeft;

        setPaneRatios((current) => {
          const normalized = normalizeRatios(visiblePaneIds, current);
          normalized[leftId] = nextLeft;
          normalized[rightId] = nextRight;
          return {
            ...current,
            ...normalized,
          };
        });
        return;
      }

      if (activeResize.kind === "stackPrimary") {
        const startRatio = activeResize.startStackPrimaryRatio ?? stackPrimaryRatio;
        const delta = activeResize.stackPrimarySide === "right" ? -deltaRatio : deltaRatio;
        const next = Math.max(0.24, Math.min(0.76, startRatio + delta));
        setStackPrimaryRatio(next);
        return;
      }

      if (activeResize.kind === "stackSecondary") {
        if (!activeResize.topId || !activeResize.bottomId) return;
        const startRatio = activeResize.startStackSecondaryRatio ?? stackSecondaryRatio;
        const minTop = MIN_PANE_HEIGHT[activeResize.topId] / activeResize.containerSize;
        const minBottom = MIN_PANE_HEIGHT[activeResize.bottomId] / activeResize.containerSize;
        const minTotal = minTop + minBottom;
        const minScale = minTotal > 1 && minTotal > 0 ? 1 / minTotal : 1;
        const effectiveMinTop = minTop * minScale;
        const effectiveMinBottom = minBottom * minScale;
        let next = startRatio + deltaRatio;
        next = Math.max(effectiveMinTop, Math.min(1 - effectiveMinBottom, next));
        setStackSecondaryRatio(next);
      }
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

  if (isSignedIn && project === undefined) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading project...</div>
      </div>
    );
  }

  if (isSignedIn && project === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Project not found.</div>
      </div>
    );
  }

  const displayProjectName = project?.name ?? "Guest Project";

  const activeDropPane = dropTarget?.paneId ?? null;
  const activeDropZone = dropTarget?.zone ?? null;

  const renderPane = (paneId: PaneId, style?: React.CSSProperties, extraClassName?: string) => {
    const isActive = activePane === paneId;
    const showDrop = draggingPane !== null && draggingPane !== paneId && activeDropPane === paneId && activeDropZone;

    return (
      <div
        key={paneId}
        className={`relative min-w-0 min-h-0 flex flex-col bg-card border border-border rounded-lg overflow-hidden ${isActive ? "ring-2 ring-primary" : ""} ${extraClassName ?? ""}`}
        style={style}
        onClick={() => setActivePane(paneId)}
        onDragOver={(event) => handlePaneDragOver(event, paneId)}
        onDrop={(event) => handlePaneDrop(event, paneId)}
      >
        {showDrop && activeDropZone === "left" && <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-primary/70 pointer-events-none z-20" />}
        {showDrop && activeDropZone === "right" && <div className="absolute right-0 top-0 bottom-0 w-1.5 bg-primary/70 pointer-events-none z-20" />}
        {showDrop && activeDropZone === "top" && <div className="absolute left-0 right-0 top-0 h-1.5 bg-primary/70 pointer-events-none z-20" />}
        {showDrop && activeDropZone === "bottom" && <div className="absolute left-0 right-0 bottom-0 h-1.5 bg-primary/70 pointer-events-none z-20" />}
        {showDrop && activeDropZone === "center" && <div className="absolute inset-0 border-2 border-primary/70 pointer-events-none z-20" />}

        {paneId === "chat" && (
          <ChatPanel
            ref={chatPanelRef}
            projectId={projectId ?? id}
            projectName={displayProjectName}
            currentCode={code}
            onCodeChange={handleCodeChange}
            onPromptComplete={handlePromptComplete}
            inputRef={chatInputRef}
            requestViewportSnapshot={requestViewportSnapshot}
            ownerId={userId}
            isAgentEnabled={isSignedIn && !!projectId}
            agentDisabledMessage="You are not logged in. Sign in to use the agent."
            headerDraggable={visiblePaneIds.length > 1}
            onHeaderDragStart={(event) => handlePaneDragStart("chat", event)}
            onHeaderDragEnd={clearPaneDrag}
          />
        )}

        {paneId === "code" && (
          <CodeEditor
            code={code}
            onChange={handleCodeChange}
            error={error}
            ref={editorRef}
            headerDraggable={visiblePaneIds.length > 1}
            onHeaderDragStart={(event) => handlePaneDragStart("code", event)}
            onHeaderDragEnd={clearPaneDrag}
          />
        )}

        {paneId === "viewport" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <div
              className={`flex items-center gap-2 px-4 py-2 border-b border-border ${visiblePaneIds.length > 1 ? "cursor-move" : ""}`}
              draggable={visiblePaneIds.length > 1}
              onDragStart={(event) => handlePaneDragStart("viewport", event)}
              onDragEnd={clearPaneDrag}
            >
              <Box className="w-4 h-4 text-cyan-500" />
              <h2 className="text-sm font-medium text-foreground">3D Viewer</h2>
            </div>

            <div className="flex-1 min-h-0 flex">
              <div className="flex-1 min-h-0 relative">
                <button
                  onClick={handleInsertViewportSnapshot}
                  disabled={isSnapshotting || geometryCount === 0 || isGenerating}
                  className="absolute top-2 left-2 z-10 p-2 rounded-md bg-background/90 border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/70 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title={geometryCount === 0 ? "Run code to capture a model snapshot" : "Insert the current view into your next prompt"}
                >
                  <Camera className="w-4 h-4" />
                </button>
                <Viewport3D
                  geometry={geometry}
                  isGenerating={isGenerating}
                  ref={viewportRef}
                />
              </div>

              {parameterDefs.length > 0 && (
                <div className="w-72 min-w-[240px] border-l border-border flex flex-col">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      <SlidersHorizontal className="w-4 h-4" />
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
                  <div className="flex-1 overflow-y-auto p-3">
                    <ParameterSliders
                      parameters={parameterDefs}
                      values={parameters}
                      onChange={handleParameterChange}
                      onReset={handleResetParameter}
                      ref={parametersRef}
                    />
                  </div>
                </div>
              )}
            </div>

            {showGeometryInfo && (
              <div className="border-t border-border p-4 max-h-80 overflow-y-auto">
                <GeometryInfo geometry={geometry} />
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
    );
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
            <h1 className="font-semibold text-lg">{displayProjectName}</h1>
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
          <button
            onClick={handleResetLayout}
            className="p-2 rounded-lg transition-colors hover:bg-secondary"
            title="Reset Pane Layout"
          >
            <RotateCcw className="w-5 h-5" />
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
        className={`flex-1 flex overflow-hidden p-1.5 gap-1.5 ${isResizing ? "select-none" : ""}`}
        onDragOverCapture={handleRootDragOverCapture}
        onDropCapture={handleRootDropCapture}
      >
        {(() => {
          const ordered = visiblePaneIds;

          if (ordered.length <= 1) {
            return renderPane(ordered[0], { flex: 1 });
          }

          if (layoutMode === "rows") {
            return (
              <div className="flex-1 min-h-0 flex flex-col">
                {ordered.map((paneId, index) => (
                  <div key={paneId} className="contents">
                    {renderPane(paneId, { flexBasis: 0, flexGrow: visiblePaneRatios[paneId], flexShrink: 1 })}
                    {index < ordered.length - 1 && (
                      <div
                        className="h-1.5 bg-border/80 hover:bg-primary/40 transition-colors cursor-row-resize"
                        onMouseDown={(event) => startPairResize("y", paneId, ordered[index + 1], event)}
                      />
                    )}
                  </div>
                ))}
              </div>
            );
          }

          if (layoutMode === "leftStack" && ordered.length === 3) {
            const [leftPane, topPane, bottomPane] = ordered;
            return (
              <div className="flex-1 min-h-0 flex">
                {renderPane(leftPane, { flexBasis: 0, flexGrow: stackPrimaryRatio, flexShrink: 1 })}
                <div
                  className="w-1.5 bg-border/80 hover:bg-primary/40 transition-colors cursor-col-resize"
                  onMouseDown={startStackPrimaryResize}
                />
                <div style={{ flexBasis: 0, flexGrow: 1 - stackPrimaryRatio, flexShrink: 1 }} className="min-h-0 flex flex-col">
                  {renderPane(topPane, { flexBasis: 0, flexGrow: stackSecondaryRatio, flexShrink: 1 })}
                  <div
                    className="h-1.5 bg-border/80 hover:bg-primary/40 transition-colors cursor-row-resize"
                    onMouseDown={(event) => startStackSecondaryResize(topPane, bottomPane, event)}
                  />
                  {renderPane(bottomPane, { flexBasis: 0, flexGrow: 1 - stackSecondaryRatio, flexShrink: 1 })}
                </div>
              </div>
            );
          }

          if (layoutMode === "rightStack" && ordered.length === 3) {
            const [topPane, bottomPane, rightPane] = ordered;
            return (
              <div className="flex-1 min-h-0 flex">
                <div style={{ flexBasis: 0, flexGrow: stackPrimaryRatio, flexShrink: 1 }} className="min-h-0 flex flex-col">
                  {renderPane(topPane, { flexBasis: 0, flexGrow: stackSecondaryRatio, flexShrink: 1 })}
                  <div
                    className="h-1.5 bg-border/80 hover:bg-primary/40 transition-colors cursor-row-resize"
                    onMouseDown={(event) => startStackSecondaryResize(topPane, bottomPane, event)}
                  />
                  {renderPane(bottomPane, { flexBasis: 0, flexGrow: 1 - stackSecondaryRatio, flexShrink: 1 })}
                </div>
                <div
                  className="w-1.5 bg-border/80 hover:bg-primary/40 transition-colors cursor-col-resize"
                  onMouseDown={startStackPrimaryResize}
                />
                {renderPane(rightPane, { flexBasis: 0, flexGrow: 1 - stackPrimaryRatio, flexShrink: 1 })}
              </div>
            );
          }

          return (
            <div className="flex-1 min-h-0 flex">
              {ordered.map((paneId, index) => (
                <div key={paneId} className="contents">
                  {renderPane(paneId, { flexBasis: 0, flexGrow: visiblePaneRatios[paneId], flexShrink: 1 })}
                  {index < ordered.length - 1 && (
                    <div
                      className="w-1.5 bg-border/80 hover:bg-primary/40 transition-colors cursor-col-resize"
                      onMouseDown={(event) => startPairResize("x", paneId, ordered[index + 1], event)}
                    />
                  )}
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      <ExportDialog
        isOpen={showExport}
        onClose={() => setShowExport(false)}
        geometry={geometry}
        projectName={displayProjectName}
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
