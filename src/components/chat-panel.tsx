"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import {
  Send,
  Loader2,
  Bot,
  User,
  Wrench,
  AlertCircle,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import { trpc } from "@/lib/trpc-provider";
import { getOpenRouterSettings } from "@/lib/openrouter";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useQuery, useMutation } from "convex/react";

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

interface ChatPanelProps {
  projectId: string;
  currentCode: string;
  onCodeChange: (code: string) => void;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export function ChatPanel({
  projectId,
  currentCode,
  onCodeChange,
  inputRef: externalInputRef,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const internalInputRef = useRef<HTMLTextAreaElement>(null);
  
  // Use external ref if provided, otherwise internal
  const inputRef = (externalInputRef || internalInputRef) as React.RefObject<HTMLTextAreaElement>;

  // Convex hooks for chat persistence
  const convexMessages = useQuery(api.chat.list, { projectId: projectId as Id<"projects"> });
  const sendMessage = useMutation(api.chat.send);

  const generateMutation = trpc.codegen.generate.useMutation();

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
    try {
      const settings = getOpenRouterSettings();

      const result = await generateMutation.mutateAsync({
        prompt,
        currentCode,
        openRouterApiKey: settings.apiKey,
        model: settings.model,
        maxIterations: 5,
      });

      // Add tool call results
      if (result.toolResults.length > 0) {
        onAddMessage({
          role: "tool",
          content: `Executed ${result.toolResults.length} tool call(s) in ${result.iterations} iteration(s).`,
          toolCalls: result.toolResults,
        });
      }

      // Add assistant message
      if (result.assistantMessage) {
        onAddMessage({
          role: "assistant",
          content: result.assistantMessage,
        });
      }

      // Update code
      if (result.code && result.code !== currentCode) {
        onCodeUpdate(result.code);
      }
    } catch (error) {
      onAddMessage({
        role: "system",
        content: `Error: ${error instanceof Error ? error.message : "Failed to generate code"}`,
      });
    } finally {
      setIsGenerating(false);
    }
  }, [currentCode, generateMutation, onAddMessage, onCodeUpdate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isGenerating) return;

    const prompt = input.trim();
    setInput("");

    // Add user message
    await onAddMessage({
      role: "user",
      content: prompt,
    });

    await generateResponse(prompt);
  };

  const handleRetry = useCallback(async () => {
    if (isGenerating) return;
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (lastUserMsg) {
      await generateResponse(lastUserMsg.content);
    }
  }, [isGenerating, messages, generateResponse]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 border-r border-zinc-800">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
        <MessageSquare className="w-4 h-4 text-indigo-400" />
        <h2 className="text-sm font-medium text-zinc-200">Chat</h2>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {messages.map((msg, i) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isLast={i === messages.length - 1}
            onRetry={handleRetry}
          />
        ))}

        {isGenerating && (
          <div className="flex items-center gap-2 text-zinc-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Generating...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-zinc-800 p-3"
      >
        <div className="relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what you want to build..."
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 pr-12 text-sm text-zinc-200 placeholder:text-zinc-600 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
            rows={3}
            disabled={isGenerating}
          />
          <button
            type="submit"
            disabled={!input.trim() || isGenerating}
            className="absolute right-2 bottom-2 p-2 rounded-md bg-indigo-600 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-500 transition-colors"
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
  isLast,
  onRetry,
}: {
  message: ChatMessage;
  isLast?: boolean;
  onRetry?: () => void;
}) {
  const roleConfig = {
    user: {
      icon: User,
      label: "You",
      bgColor: "bg-indigo-950/50",
      borderColor: "border-indigo-900/50",
      textColor: "text-zinc-200",
    },
    assistant: {
      icon: Bot,
      label: "AI",
      bgColor: "bg-zinc-900/50",
      borderColor: "border-zinc-800",
      textColor: "text-zinc-300",
    },
    system: {
      icon: AlertCircle,
      label: "System",
      bgColor: "bg-amber-950/30",
      borderColor: "border-amber-900/30",
      textColor: "text-amber-200/80",
    },
    tool: {
      icon: Wrench,
      label: "Tools",
      bgColor: "bg-emerald-950/30",
      borderColor: "border-emerald-900/30",
      textColor: "text-emerald-200/80",
    },
  };

  const config = roleConfig[message.role];
  const Icon = config.icon;

  return (
    <div
      className={`rounded-lg border p-3 ${config.bgColor} ${config.borderColor}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-3.5 h-3.5 text-zinc-500" />
        <span className="text-xs font-medium text-zinc-500">
          {config.label}
        </span>
      </div>
      <div className={`text-sm ${config.textColor} whitespace-pre-wrap`}>
        {message.content}
      </div>

      {message.role === "system" && isLast && onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          Retry
        </button>
      )}

      {/* Tool calls expansion */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <ToolCallsDisplay toolCalls={message.toolCalls} />
      )}
    </div>
  );
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

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-emerald-400 hover:text-emerald-300 underline"
      >
        {expanded ? "Hide" : "Show"} {toolCalls.length} tool call
        {toolCalls.length !== 1 ? "s" : ""}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {toolCalls.map((tc, i) => (
            <div
              key={i}
              className="bg-zinc-900 rounded p-2 text-xs font-mono"
            >
              <div className="text-emerald-400 mb-1">{tc.toolName}</div>
              <div className="text-zinc-500">
                {JSON.stringify(tc.args, null, 2).substring(0, 200)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
