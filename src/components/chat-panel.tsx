"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Send,
  Loader2,
  Bot,
  User,
  Wrench,
  AlertCircle,
  MessageSquare,
  CheckCircle2,
  RefreshCw,
  Copy,
} from "lucide-react";
import { getOpenRouterSettings } from "@/lib/openrouter";
import { api } from "@/convex/_generated/api";
import { useQuery, useMutation } from "convex/react";
import { Id } from "@/convex/_generated/dataModel";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: Array<{
    toolName: string;
    args: Record<string, unknown>;
    result: unknown;
  }>;
}

interface LiveToolCall {
  id: string;
  iteration: number;
  index: number;
  total: number;
  toolName: string;
  args: Record<string, unknown>;
  status: "running" | "completed";
  result?: unknown;
}

type StreamEvent =
  | { type: "iteration_started"; iteration: number }
  | {
      type: "tool_call_started";
      iteration: number;
      index: number;
      total: number;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_call_completed";
      iteration: number;
      index: number;
      total: number;
      toolName: string;
      args: Record<string, unknown>;
      result: unknown;
      parseError?: string;
    }
  | { type: "diagnostics"; iteration: number; errors: number; warnings: number; info: number }
  | { type: "assistant_message_delta"; delta: string }
  | { type: "assistant_message"; content: string }
  | {
      type: "done";
      payload: {
        code: string;
        toolResults: Array<{ toolName: string; args: Record<string, unknown>; result: unknown }>;
        iterations: number;
        assistantMessage?: string;
      };
    }
  | { type: "error"; message: string };

interface ChatPanelProps {
  projectId: string;
  projectName?: string;
  currentCode: string;
  onCodeChange: (code: string) => void;
  onPromptComplete?: () => void;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}

const defaultProjectNames = new Set([
  "untitled project",
  "new project from template",
]);

function deriveProjectName(prompt: string) {
  const cleaned = prompt
    .replace(/[`*_#>~\[\]{}()<>]/g, " ")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = cleaned.split(" ").filter(Boolean).slice(0, 6);
  if (words.length === 0) return "";

  const title = words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  return title.slice(0, 60).trim();
}

async function requestProjectTitle(prompt: string, apiKey: string) {
  try {
    const response = await fetch("/api/project-title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, apiKey }),
    });

    if (!response.ok) {
      return "";
    }

    const data = (await response.json()) as { title?: string };
    return typeof data.title === "string" ? data.title : "";
  } catch {
    return "";
  }
}

export function ChatPanel({
  projectId,
  projectName,
  currentCode,
  onCodeChange,
  onPromptComplete,
  inputRef: externalInputRef,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [liveToolCalls, setLiveToolCalls] = useState<LiveToolCall[]>([]);
  const [streamStatus, setStreamStatus] = useState<string>("");
  const [liveAssistantMessage, setLiveAssistantMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const internalInputRef = useRef<HTMLTextAreaElement>(null);
  
  // Use external ref if provided, otherwise internal
  const inputRef = (externalInputRef || internalInputRef) as React.RefObject<HTMLTextAreaElement>;

  // Convex hooks for chat persistence
  const convexMessages = useQuery(api.chat.list, { projectId: projectId as Id<"projects"> });
  const sendMessage = useMutation(api.chat.send);
  const updateProject = useMutation(api.projects.update);

  // Load messages from Convex when they change
  useEffect(() => {
    if (convexMessages) {
      const loadedMessages: ChatMessage[] = convexMessages.map((msg: { _id: string; role: string; content: string; toolCalls?: unknown }) => ({
        id: msg._id,
        role: msg.role as "user" | "assistant" | "system" | "tool",
        content: msg.content,
        toolCalls: msg.toolCalls as Array<{ toolName: string; args: Record<string, unknown>; result: unknown }> | undefined,
      }));
      setMessages(loadedMessages);
    }
  }, [convexMessages]);

  const persistMessage = useCallback(async (message: Omit<ChatMessage, "id">) => {
    try {
      await sendMessage({
        projectId: projectId as Id<"projects">,
        role: message.role,
        content: message.content,
        toolCalls: message.toolCalls,
      });
    } catch (error) {
      console.error("Failed to persist message:", error);
    }
  }, [projectId, sendMessage]);

  const onAddMessage = useCallback(async (message: Omit<ChatMessage, "id">) => {
    // Add to local state immediately for responsiveness
    setMessages((prev) => [...prev, { ...message, id: Math.random().toString(36).slice(2) }]);
    // Persist to Convex
    await persistMessage(message);
  }, [persistMessage]);

  const onCodeUpdate = useCallback((code: string) => {
    onCodeChange(code);
  }, [onCodeChange]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const generateResponse = useCallback(async (prompt: string) => {
    setIsGenerating(true);
    setLiveToolCalls([]);
    setLiveAssistantMessage("");
    setStreamStatus("Starting agent...");

    try {
      const settings = getOpenRouterSettings();

      const response = await fetch("/api/codegen/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          currentCode,
          openRouterApiKey: settings.apiKey,
          model: settings.model,
          maxIterations: 5,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Streaming failed (${response.status})`);
      }

      if (!response.body) {
        throw new Error("Streaming response body is empty.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalPayload:
        | {
            code: string;
            toolResults: Array<{ toolName: string; args: Record<string, unknown>; result: unknown }>;
            iterations: number;
            assistantMessage?: string;
          }
        | null = null;
      let latestAssistantMessage: string | undefined;

      const upsertLiveToolCall = (
        call: Omit<LiveToolCall, "status"> & { status: "running" | "completed"; result?: unknown }
      ) => {
        setLiveToolCalls((prev) => {
          const idx = prev.findIndex((x) => x.id === call.id);
          if (idx === -1) {
            return [...prev, call];
          }
          const next = [...prev];
          next[idx] = { ...next[idx], ...call };
          return next;
        });
      };

      const handleEvent = (event: StreamEvent) => {
        if (event.type === "iteration_started") {
          setStreamStatus(`Iteration ${event.iteration}...`);
          return;
        }

        if (event.type === "tool_call_started") {
          const id = `${event.iteration}-${event.index}-${event.toolName}`;
          setStreamStatus(
            `Running tool ${event.index}/${event.total}: ${event.toolName}`
          );
          upsertLiveToolCall({
            id,
            iteration: event.iteration,
            index: event.index,
            total: event.total,
            toolName: event.toolName,
            args: event.args,
            status: "running",
          });
          return;
        }

        if (event.type === "tool_call_completed") {
          const id = `${event.iteration}-${event.index}-${event.toolName}`;
          upsertLiveToolCall({
            id,
            iteration: event.iteration,
            index: event.index,
            total: event.total,
            toolName: event.toolName,
            args: event.args,
            status: "completed",
            result: event.result,
          });
          setStreamStatus(`Finished ${event.toolName}`);
          return;
        }

        if (event.type === "diagnostics") {
          setStreamStatus(
            `Diagnostics: ${event.errors} errors, ${event.warnings} warnings`
          );
          return;
        }

        if (event.type === "assistant_message") {
          latestAssistantMessage = event.content;
          setLiveAssistantMessage(event.content);
          setStreamStatus("Finalizing response...");
          return;
        }

        if (event.type === "assistant_message_delta") {
          setLiveAssistantMessage((prev) => prev + event.delta);
          setStreamStatus("Streaming response...");
          return;
        }

        if (event.type === "done") {
          finalPayload = event.payload;
          return;
        }

        if (event.type === "error") {
          throw new Error(event.message);
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const eventBlock of events) {
          const dataLines = eventBlock
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim());

          if (dataLines.length === 0) continue;

          const data = dataLines.join("\n");
          const parsed = JSON.parse(data) as StreamEvent;
          handleEvent(parsed);
        }
      }

      if (!finalPayload) {
        throw new Error("Stream ended before completion payload.");
      }

      const donePayload = finalPayload as {
        code: string;
        toolResults: Array<{ toolName: string; args: Record<string, unknown>; result: unknown }>;
        iterations: number;
        assistantMessage?: string;
      };

      if (donePayload.toolResults.length > 0) {
        await onAddMessage({
          role: "tool",
          content: `Tool calls (${donePayload.toolResults.length})`,
          toolCalls: donePayload.toolResults,
        });
      }

      const assistant = donePayload.assistantMessage || latestAssistantMessage;
      if (assistant) {
        await onAddMessage({
          role: "assistant",
          content: assistant,
        });
      }

      if (donePayload.code && donePayload.code !== currentCode) {
        onCodeUpdate(donePayload.code);
      }
    } catch (error) {
      await onAddMessage({
        role: "system",
        content: `Error: ${error instanceof Error ? error.message : "Failed to generate code"}`,
      });
    } finally {
      setStreamStatus("");
      setIsGenerating(false);
      setLiveAssistantMessage("");
      onPromptComplete?.();
    }
  }, [currentCode, onAddMessage, onCodeUpdate, onPromptComplete]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isGenerating) return;

    const prompt = input.trim();
    setInput("");

    const hasUserMessages = messages.some((msg) => msg.role === "user");
    const canAutoName = projectName
      ? defaultProjectNames.has(projectName.trim().toLowerCase())
      : false;
    if (!hasUserMessages && canAutoName) {
      let derivedName = deriveProjectName(prompt);
      const settings = getOpenRouterSettings();
      const suggestedName = await requestProjectTitle(prompt, settings.apiKey);
      if (suggestedName) {
        derivedName = suggestedName;
      }
      if (
        derivedName &&
        projectName &&
        derivedName.toLowerCase() !== projectName.trim().toLowerCase()
      ) {
        try {
          await updateProject({
            id: projectId as Id<"projects">,
            name: derivedName,
          });
        } catch (error) {
          console.warn("Failed to auto-rename project:", error);
        }
      }
    }

    // Add user message
    await onAddMessage({
      role: "user",
      content: prompt,
    });

    await generateResponse(prompt);
  };

  const handleRetry = useCallback(async (prompt: string) => {
    if (!prompt.trim() || isGenerating) return;
    await onAddMessage({
      role: "user",
      content: prompt,
    });
    await generateResponse(prompt);
  }, [generateResponse, isGenerating, onAddMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex flex-col h-full bg-card border-r border-border">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <MessageSquare className="w-4 h-4 text-indigo-500" />
        <h2 className="text-sm font-medium text-foreground">Chat</h2>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {messages.map((msg, index) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            retryPrompt={getRetryPrompt(messages, index)}
            onRetry={handleRetry}
            isGenerating={isGenerating}
          />
        ))}

        {isGenerating && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 dark:border-emerald-900/60 dark:bg-emerald-950/20 p-3 space-y-2">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-300 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{streamStatus || "Running tools..."}</span>
            </div>
            {liveAssistantMessage && (
              <div className="rounded-md border border-emerald-500/20 bg-background/50 dark:border-emerald-900/40 dark:bg-zinc-950/40 p-2 text-sm text-emerald-800 dark:text-emerald-100/90 prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {liveAssistantMessage}
                </ReactMarkdown>
              </div>
            )}
            {liveToolCalls.length > 0 && (
              <div className="space-y-1">
                {liveToolCalls.map((call) => (
                  <div
                    key={call.id}
                    className="text-xs rounded bg-secondary/70 border border-border px-2 py-1 text-secondary-foreground flex items-center gap-2"
                  >
                    {call.status === "running" ? (
                      <Loader2 className="w-3 h-3 animate-spin text-emerald-500" />
                    ) : (
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                    )}
                    <span className="font-mono">{call.toolName}</span>
                    <span className="text-muted-foreground">({call.index}/{call.total})</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-border p-3"
      >
        <div className="relative h-full">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you want to build..."
            className="h-full w-full bg-background border border-input rounded-lg px-4 py-3 pr-12 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring"
            rows={3}
            disabled={isGenerating}
          />
          <button
            type="submit"
            disabled={!input.trim() || isGenerating}
            className="absolute right-2 bottom-2 p-2 rounded-md bg-primary text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({
  message,
  retryPrompt,
  onRetry,
  isGenerating,
}: {
  message: ChatMessage;
  retryPrompt?: string;
  onRetry?: (prompt: string) => void;
  isGenerating?: boolean;
}) {
  const roleConfig = {
    user: {
      icon: User,
      label: "You",
      bgColor: "bg-indigo-500/10 dark:bg-indigo-950/50",
      borderColor: "border-indigo-500/30 dark:border-indigo-900/50",
      textColor: "text-foreground",
    },
    assistant: {
      icon: Bot,
      label: "AI",
      bgColor: "bg-secondary/50",
      borderColor: "border-border",
      textColor: "text-secondary-foreground",
    },
    system: {
      icon: AlertCircle,
      label: "System",
      bgColor: "bg-amber-500/10 dark:bg-amber-950/30",
      borderColor: "border-amber-500/30 dark:border-amber-900/30",
      textColor: "text-amber-700 dark:text-amber-200/80",
    },
    tool: {
      icon: Wrench,
      label: "Tools",
      bgColor: "bg-emerald-500/10 dark:bg-emerald-950/30",
      borderColor: "border-emerald-500/30 dark:border-emerald-900/30",
      textColor: "text-emerald-700 dark:text-emerald-200/80",
    },
  };

  const config = roleConfig[message.role];
  const Icon = config.icon;

  return (
    <div>
      <div
        className={`rounded-lg border p-3 ${config.bgColor} ${config.borderColor}`}
      >
        <div className="flex items-center gap-2 mb-1">
          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">
            {config.label}
          </span>
        </div>
        <div
          className={`text-sm ${config.textColor} prose prose-sm dark:prose-invert max-w-none break-words [&>p]:mb-2 [&>p:last-child]:mb-0 [&>pre]:bg-black/50 [&>pre]:p-2 [&>pre]:rounded-md`}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        </div>

        {/* Tool calls expansion */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <ToolCallsDisplay toolCalls={message.toolCalls} />
        )}
      </div>
      {message.role === "user" && retryPrompt && onRetry && (
        <div className="mt-2 flex justify-end">
          <button
            onClick={() => onRetry(retryPrompt)}
            disabled={isGenerating}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Retry this prompt"
            type="button"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}

function getRetryPrompt(messages: ChatMessage[], index: number) {
  const current = messages[index];
  if (current?.role === "user") {
    return current.content;
  }
  for (let i = index - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === "user") {
      return message.content;
    }
  }
  return "";
}

function ToolCallsDisplay({
  toolCalls,
}: {
  toolCalls: Array<{
    toolName: string;
    args: Record<string, unknown>;
    result: unknown;
  }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyAll = useCallback(async () => {
    const payload = JSON.stringify(toolCalls, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, [toolCalls]);

  return (
    <div className="mt-2 relative">
      <div className="flex items-center gap-3 pr-6">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-emerald-400 hover:text-emerald-300 underline"
          type="button"
        >
          {expanded ? "Hide" : "Show"} {toolCalls.length} tool call
          {toolCalls.length !== 1 ? "s" : ""}
        </button>
      </div>
      <button
        onClick={handleCopyAll}
        className={
          copied
            ? "absolute right-0 top-0 text-emerald-400"
            : "absolute right-0 top-0 text-zinc-400 hover:text-zinc-200"
        }
        aria-label={copied ? "Copied tool calls" : "Copy tool calls"}
        title={copied ? "Copied" : "Copy all tool calls"}
        type="button"
      >
        <Copy className="w-3.5 h-3.5" />
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {toolCalls.map((tc, i) => (
            <div key={i} className="bg-secondary rounded p-2 text-xs font-mono">
              <div className="text-emerald-600 dark:text-emerald-400 mb-1">{tc.toolName}</div>
              <div className="text-muted-foreground">
                {JSON.stringify(tc.args, null, 2).substring(0, 200)}
              </div>
              <div className="text-secondary-foreground mt-1">
                {JSON.stringify(tc.result, null, 2).substring(0, 200)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
