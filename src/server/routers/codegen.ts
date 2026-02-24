import { z } from "zod";
import path from "path";
import { readFile } from "fs/promises";
import { router, publicProcedure } from "../trpc";
import { getOpenRouterEndpoint } from "@/lib/openrouter";

export const generateInputSchema = z.object({
  prompt: z.string(),
  promptImages: z
    .array(
      z.object({
        url: z.string(),
        altText: z.string().optional(),
      })
    )
    .optional(),
  viewportSnapshot: z
    .object({
      url: z.string(),
      altText: z.string().optional(),
    })
    .optional(),
  currentCode: z.string().optional(),
  projectContext: z
    .object({
      projectName: z.string().optional(),
      previousPrompts: z.array(z.string()).optional(),
      parameters: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  openRouterApiKey: z.string().optional(),
  model: z.string().default("google/gemini-3-flash-preview|reasoning=high"),
  maxIterations: z.number().default(5),
});

export type GenerateInput = z.infer<typeof generateInputSchema>;

/**
 * AI code generation router — handles OpenRouter API calls
 * and the 15-tool agent system for JSCAD vibecoding.
 */
export const codegenRouter = router({
  /**
   * Generate JSCAD code from a natural language prompt.
   * This is the main AI endpoint that orchestrates the tool-calling loop.
   */
  generate: publicProcedure
    .input(generateInputSchema)
    .mutation(async ({ input }) => runCodegen(input)),
});

// --- Types ---

interface OpenRouterMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | OpenRouterContentPart[];
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

type OpenRouterContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

const MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)]+)\)/g;
const MAX_INLINE_PROMPT_IMAGES = 4;

function buildUserPromptContent(
  prompt: string,
  promptImages?: Array<{ url: string; altText?: string }>
): string | OpenRouterContentPart[] {
  const parts: OpenRouterContentPart[] = [];
  let lastIndex = 0;
  let imageCount = 0;

  for (const match of prompt.matchAll(MARKDOWN_IMAGE_PATTERN)) {
    const fullMatch = match[0];
    const alt = (match[1] || "").trim();
    const rawUrl = (match[2] || "").trim();
    const matchIndex = match.index ?? 0;

    const textSegment = prompt.slice(lastIndex, matchIndex);
    if (textSegment.trim()) {
      parts.push({ type: "text", text: textSegment });
    }

    const isDataImage = /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(rawUrl);
    const isHttpImage = /^https?:\/\//i.test(rawUrl);

    if ((isDataImage || isHttpImage) && imageCount < MAX_INLINE_PROMPT_IMAGES) {
      parts.push({ type: "image_url", image_url: { url: rawUrl } });
      imageCount += 1;
      if (alt) {
        parts.push({ type: "text", text: `Image note: ${alt}` });
      }
    } else {
      parts.push({
        type: "text",
        text: fullMatch,
      });
    }

    lastIndex = matchIndex + fullMatch.length;
  }

  const remainder = prompt.slice(lastIndex);
  if (remainder.trim()) {
    parts.push({ type: "text", text: remainder });
  }

  const availableImageSlots = Math.max(0, MAX_INLINE_PROMPT_IMAGES - imageCount);
  const normalizedPromptImages = (promptImages ?? [])
    .map((image) => ({
      url: image.url.trim(),
      altText: image.altText?.trim() || "Attached image",
    }))
    .filter((image) => /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(image.url) || /^https?:\/\//i.test(image.url))
    .slice(0, availableImageSlots);

  for (const image of normalizedPromptImages) {
    parts.push({ type: "image_url", image_url: { url: image.url } });
    if (image.altText) {
      parts.push({ type: "text", text: `Image note: ${image.altText}` });
    }
  }

  if (parts.length === 0) {
    return prompt;
  }

  const hasImagePart = parts.some((part) => part.type === "image_url");
  if (!hasImagePart) {
    return prompt;
  }

  return parts;
}

function isSupportedImageUrl(url: string) {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(url) || /^https?:\/\//i.test(url);
}

interface ToolRuntimeContext {
  viewportSnapshot?: {
    url: string;
    altText: string;
  };
}

function parseModelSpec(model: string | undefined) {
  // Always return a defined model string
  const fallback = "google/gemini-3-flash-preview|reasoning=high";
  if (!model) return { model: fallback, reasoning: undefined } as const;
  const match = model.match(/\|reasoning=(low|high)$/);
  if (!match) {
    return { model: model, reasoning: undefined } as const;
  }
  const effort = match[1] as "low" | "high";
  const baseModel = model.replace(/\|reasoning=(low|high)$/, "");
  return { model: baseModel, reasoning: { effort } } as const;
}

function containsCodeLikeContent(content?: string) {
  if (!content) return false;
  return (
    /```[\s\S]*?```/.test(content) ||
    /module\.exports\s*=/.test(content) ||
    /function\s+main\s*\(/.test(content) ||
    /require\(['"]@jscad\/modeling['"]\)/.test(content)
  );
}

interface ToolCallRecord {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface GenerateResult {
  code: string;
  toolResults: ToolCallRecord[];
  iterations: number;
  assistantMessage?: string;
}

export type GenerateStreamEvent =
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
  | {
      type: "diagnostics";
      iteration: number;
      errors: number;
      warnings: number;
      info: number;
    }
  | { type: "assistant_message_delta"; delta: string }
  | { type: "assistant_message"; content: string }
  | { type: "done"; payload: GenerateResult };

export async function runCodegen(
  input: GenerateInput,
  onEvent?: (event: GenerateStreamEvent) => Promise<void> | void
): Promise<GenerateResult> {
  const {
    prompt,
    promptImages,
    viewportSnapshot,
    currentCode,
    projectContext,
    openRouterApiKey,
    model,
    maxIterations,
  } = input;

  const rawApiKey =
    openRouterApiKey?.trim() || process.env.OPENROUTER_API_KEY?.trim();
  // Allow inference if SIGNED_OUT_INFERENCE is set, even without API key
  const signedOutInference = process.env.SIGNED_OUT_INFERENCE === "1";
  if (!rawApiKey && !signedOutInference) {
    throw new Error(
      "OpenRouter API key is missing. Please configure it in Settings or on the server, or set SIGNED_OUT_INFERENCE=1 to allow inference when signed out."
    );
  }
  const apiKey = rawApiKey ?? "";

  const { model: resolvedModel, reasoning } = parseModelSpec(model);

  const tools = buildToolDefinitions();
  const systemPrompt = buildSystemPrompt(currentCode, projectContext);
  const userPromptContent = buildUserPromptContent(prompt, promptImages);

  const messages: OpenRouterMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPromptContent },
  ];

  const toolResults: ToolCallRecord[] = [];
  const runtimeContext: ToolRuntimeContext = {};
  if (viewportSnapshot?.url && isSupportedImageUrl(viewportSnapshot.url.trim())) {
    runtimeContext.viewportSnapshot = {
      url: viewportSnapshot.url.trim(),
      altText: viewportSnapshot.altText?.trim() || "Current viewport snapshot",
    };
  }
  let finalCode = currentCode || "";
  let iterations = 0;
  let pendingRuntimeError: string | null = null;
  let pendingDiagnosticsErrors = 0;

  while (iterations < maxIterations) {
    iterations++;
    await onEvent?.({ type: "iteration_started", iteration: iterations });

    const response = await callOpenRouter({
      apiKey,
      model: String(resolvedModel ?? "google/gemini-3-flash-preview|reasoning=high"),
      messages,
      tools,
      reasoning,
    });

    const assistantMessage = response.choices[0]?.message;
    if (!assistantMessage) break;

    messages.push(assistantMessage);

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      const assistantContent =
        typeof assistantMessage.content === "string"
          ? assistantMessage.content
          : "";

      if (pendingRuntimeError || pendingDiagnosticsErrors > 0) {
        messages.push({
          role: "system",
          content:
            "You must fix the outstanding runtime/diagnostic errors before responding. Use edit_code to correct the code.",
        });
        continue;
      }

      if (containsCodeLikeContent(assistantContent)) {
        messages.push({
          role: "system",
          content:
            "Do not paste full code in assistant messages. If the user requested code creation or edits, call write_code/edit_code tools and provide only a concise status summary in text.",
        });
        continue;
      }

      if (assistantContent) {
        await onEvent?.({ type: "assistant_message", content: assistantContent });
      }
      break;
    }

    const total = assistantMessage.tool_calls.length;
    for (const [index, toolCall] of assistantMessage.tool_calls.entries()) {
      let args: Record<string, unknown> = {};
      let parseError: string | null = null;
      try {
        args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
      } catch (e: unknown) {
        parseError = e instanceof Error ? e.message : String(e);
        console.error(
          "Failed to parse tool arguments:",
          toolCall.function.arguments
        );
      }

      await onEvent?.({
        type: "tool_call_started",
        iteration: iterations,
        index: index + 1,
        total,
        toolName: toolCall.function.name,
        args,
      });

      if (parseError) {
        const parseErrorResult = {
          error: `JSON parsing failed: ${parseError}. The arguments were: ${toolCall.function.arguments}. Please retry with valid JSON format for the ${toolCall.function.name} tool.`,
        };

        await onEvent?.({
          type: "tool_call_completed",
          iteration: iterations,
          index: index + 1,
          total,
          toolName: toolCall.function.name,
          args,
          result: parseErrorResult,
          parseError,
        });

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(parseErrorResult),
        });
        continue;
      }

      const result = executeToolCall(toolCall.function.name, args, finalCode, runtimeContext);

      if (result.updatedCode !== undefined) {
        finalCode = result.updatedCode;
      }

      let toolOutput = result.output;
       if (
         toolCall.function.name === "edit_code" ||
         toolCall.function.name === "write_code"
       ) {
         const runtime = await runJscadRuntime(finalCode);
         pendingRuntimeError = runtime.ok ? null : runtime.error || "Unknown error";
         if (toolOutput && typeof toolOutput === "object") {
           toolOutput = { ...toolOutput, runtime };
         } else {
           toolOutput = { result: toolOutput, runtime };
         }
        if (!runtime.ok && runtime.error) {
          messages.push({
            role: "system",
            content: `JSCAD runtime error after ${toolCall.function.name}:\n${runtime.error}\nPlease fix this error.`,
          });
          const normalizedError = runtime.error.toLowerCase();
          if (
            normalizedError.includes("must return an array") ||
            normalizedError.includes("array contains invalid") ||
            normalizedError.includes("returned an empty array")
          ) {
            messages.push({
              role: "system",
              content:
                "Automatic runtime checks detected that main() returned a single object (or otherwise invalid geometry) instead of an array. Please wrap every geometry in an array before finishing your response.",
            });
          }
        }
      }

      toolResults.push({
        toolName: toolCall.function.name,
        args,
        result: toolOutput,
      });

      await onEvent?.({
        type: "tool_call_completed",
        iteration: iterations,
        index: index + 1,
        total,
        toolName: toolCall.function.name,
        args,
        result: toolOutput,
      });

      const shouldAttachViewportImage =
        toolCall.function.name === "get_viewport_snapshot" &&
        !!runtimeContext.viewportSnapshot &&
        !!toolOutput &&
        typeof toolOutput === "object" &&
        (toolOutput as { success?: boolean }).success === true;

      if (shouldAttachViewportImage) {
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: [
            { type: "text", text: JSON.stringify(toolOutput) },
            {
              type: "image_url",
              image_url: { url: runtimeContext.viewportSnapshot!.url },
            },
            {
              type: "text",
              text: `Image note: ${runtimeContext.viewportSnapshot!.altText}`,
            },
          ],
        });
      } else {
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolOutput),
        });
      }
    }

    const lastToolNames = (assistantMessage.tool_calls || []).map(
      (tc: { function: { name: string } }) => tc.function.name
    );
     if (
       lastToolNames.includes("edit_code") ||
       lastToolNames.includes("write_code")
     ) {
       const diagnostics = runDiagnostics(finalCode);
       pendingDiagnosticsErrors = diagnostics.errors;
       await onEvent?.({
         type: "diagnostics",
        iteration: iterations,
        errors: diagnostics.errors,
        warnings: diagnostics.warnings,
        info: diagnostics.info,
      });
      if (diagnostics.errors > 0) {
        messages.push({
          role: "system",
          content: `Auto-diagnostics detected ${diagnostics.errors} error(s):\n${JSON.stringify(diagnostics.diagnostics, null, 2)}\nPlease fix these issues.`,
        });
      }
    }
  }

  const payload: GenerateResult = {
    code: finalCode,
    toolResults,
    iterations,
    assistantMessage: undefined,
  };

  const streamFinalAssistant = async (messagesForFinal: OpenRouterMessage[]) => {
    let streamedText = "";
    streamedText = await callOpenRouterStream(
      {
        apiKey,
      model: String(resolvedModel ?? "google/gemini-3-flash-preview|reasoning=high"),
        messages: messagesForFinal,
        tools,
        toolChoice: "none",
        reasoning,
      },
      async (delta) => {
        await onEvent?.({ type: "assistant_message_delta", delta });
      }
    );

    if (streamedText) {
      await onEvent?.({ type: "assistant_message", content: streamedText });
    }

    return streamedText;
  };

  let finalAssistantContent =
    messages[messages.length - 1]?.role === "assistant"
      ? (messages[messages.length - 1] as { content?: string })?.content
      : undefined;

  if (!finalAssistantContent) {
    const streamed = await streamFinalAssistant([
      ...messages,
        {
          role: "system",
          content:
            "Provide a final response to the user. Do not call tools. Summarize what you did and what happened. Do not include full code or code blocks.",
        },
      ]);
    if (streamed) {
      finalAssistantContent = streamed;
      messages.push({ role: "assistant", content: streamed });
    }
  }

  if (!finalAssistantContent) {
    const streamed = await streamFinalAssistant([
      ...messages,
      {
        role: "system",
        content:
          "You did not provide a final response. Respond now with a concise user-facing message. Do not call tools.",
      },
    ]);
    if (streamed) {
      finalAssistantContent = streamed;
      messages.push({ role: "assistant", content: streamed });
    }
  }

  if (!finalAssistantContent) {
    finalAssistantContent = "Ready when you are. What should I do next?";
    await onEvent?.({ type: "assistant_message", content: finalAssistantContent });
  }

  if (containsCodeLikeContent(finalAssistantContent)) {
    const streamed = await streamFinalAssistant([
      ...messages,
      {
        role: "system",
        content:
          "Your previous response included code. Respond again without any code blocks or full source. Only provide a concise plain-language status update.",
      },
    ]);
    if (streamed) {
      finalAssistantContent = streamed;
      messages.push({ role: "assistant", content: streamed });
    }
  }

  payload.assistantMessage = finalAssistantContent;

  await onEvent?.({ type: "done", payload });
  return payload;
}

interface ToolResult {
  output: unknown;
  updatedCode?: string;
}

interface DiagnosticItem {
  severity: "error" | "warning" | "info";
  line: number;
  column?: number;
  message: string;
  source: string;
  code: string;
}

// --- OpenRouter API ---

const OPENROUTER_CHAT_URL = getOpenRouterEndpoint("/api/v1/chat/completions");
const OPENROUTER_MAX_TOKENS = Number(process.env.OPENROUTER_MAX_TOKENS ?? "4096");

async function callOpenRouter(params: {
  apiKey: string;
  model: string;
  messages: OpenRouterMessage[];
  tools: unknown[];
  toolChoice?: "auto" | "none";
  reasoning?: { effort: "low" | "high" };
}) {
  const response = await fetch(
    OPENROUTER_CHAT_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://openmech.app",
        "X-Title": "OpenMech",
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        tools: params.tools,
        tool_choice: params.toolChoice ?? "auto",
        provider: { sort: "price" },
        ...(params.reasoning ? { reasoning: params.reasoning } : {}),
        temperature: 0.3,
        max_tokens: OPENROUTER_MAX_TOKENS,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
  }

  return response.json();
}

async function callOpenRouterStream(
  params: {
    apiKey: string;
    model: string;
    messages: OpenRouterMessage[];
    tools: unknown[];
    toolChoice?: "auto" | "none";
    reasoning?: { effort: "low" | "high" };
  },
  onDelta: (delta: string) => Promise<void> | void
) {
  const response = await fetch(
    OPENROUTER_CHAT_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://openmech.app",
        "X-Title": "OpenMech",
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        tools: params.tools,
        tool_choice: params.toolChoice ?? "auto",
        provider: { sort: "price" },
        ...(params.reasoning ? { reasoning: params.reasoning } : {}),
        temperature: 0.3,
        max_tokens: OPENROUTER_MAX_TOKENS,
        stream: true,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
  }

  if (!response.body) {
    throw new Error("OpenRouter streaming response body is empty.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let doneStreaming = false;

  const handleEvent = async (eventBlock: string) => {
    const dataLines = eventBlock
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());

    if (dataLines.length === 0) return;
    const data = dataLines.join("\n");

    if (data === "[DONE]") {
      doneStreaming = true;
      return;
    }

    const parsed = JSON.parse(data) as {
      choices?: Array<{
        delta?: { content?: string };
      }>;
    };

    const delta = parsed.choices?.[0]?.delta?.content;
    if (delta) {
      fullText += delta;
      await onDelta(delta);
    }
  };

  while (!doneStreaming) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const eventBlock of events) {
      await handleEvent(eventBlock);
      if (doneStreaming) break;
    }
  }

  if (buffer && !doneStreaming) {
    await handleEvent(buffer);
  }

  return fullText;
}

// --- Tool Definitions (OpenAI function calling format) ---

function buildToolDefinitions() {
  return [
    {
      type: "function",
      function: {
        name: "get_viewport_snapshot",
        description:
          "Get the latest project viewport snapshot as an image attachment for visual inspection.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "write_code",
        description:
          "Write complete JSCAD code. Use this for initial generation or full rewrites.",
        parameters: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "Complete JSCAD source code",
            },
            description: {
              type: "string",
              description: "Brief description of what the code creates",
            },
          },
          required: ["code"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "edit_code",
        description:
          "Apply targeted edits to the existing JSCAD code using search-and-replace.",
        parameters: {
          type: "object",
          properties: {
            edits: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  search: {
                    type: "string",
                    description: "Exact string to find in the code",
                  },
                  replace: {
                    type: "string",
                    description: "Replacement string",
                  },
                },
                required: ["search", "replace"],
              },
              description: "Array of search-and-replace operations",
            },
          },
          required: ["edits"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_code",
        description: "Read the current JSCAD code.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "get_diagnostics",
        description:
          "Run validation on the current JSCAD code and get errors, warnings, and suggestions.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "check_intersection",
        description:
          "Check if two named geometries in the JSCAD code intersect and by how much.",
        parameters: {
          type: "object",
          properties: {
            geometryA: {
              type: "string",
              description: "Variable name of the first geometry",
            },
            geometryB: {
              type: "string",
              description: "Variable name of the second geometry",
            },
          },
          required: ["geometryA", "geometryB"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "measure_geometry",
        description:
          "Measure properties of a named geometry (bounding box, volume, surface area, etc.). For gears and racks, can also calculate pitch circle/line for proper meshing alignment.",
        parameters: {
          type: "object",
          properties: {
            geometry: {
              type: "string",
              description:
                'Variable name of the geometry, or "main" for the exported result',
            },
            measurements: {
              type: "array",
              items: {
                type: "string",
                enum: [
                  "boundingBox",
                  "volume",
                  "surfaceArea",
                  "center",
                  "dimensions",
                ],
              },
            },
            gearParams: {
              type: "object",
              properties: {
                module: {
                  type: "number",
                  description: "Gear module in mm (tooth size)",
                },
                teeth: {
                  type: "number",
                  description: "Number of teeth on the gear",
                },
              },
              description: "For gears: provide module and teeth count to calculate pitch circle (diameter = module * teeth)",
            },
            rackParams: {
              type: "object",
              properties: {
                module: {
                  type: "number",
                  description: "Rack module in mm (must match gear module for proper meshing)",
                },
              },
              description: "For racks: provide module to calculate pitch line position",
            },
          },
          required: ["geometry"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "check_printability",
        description:
          "Analyze the geometry for 3D printing issues (thin walls, overhangs, manifold checks).",
        parameters: {
          type: "object",
          properties: {
            geometry: {
              type: "string",
              description: "Variable name of the geometry to check",
            },
          },
          required: ["geometry"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_variables",
        description:
          "List all geometry variables and parameters in the current JSCAD code.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "set_parameters",
        description:
          "Update parameter values in the JSCAD code without changing the structure.",
        parameters: {
          type: "object",
          properties: {
            parameters: {
              type: "object",
              description:
                "Key-value pairs of parameter names and their new values",
              additionalProperties: true,
            },
          },
          required: ["parameters"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "ask_user",
        description:
          "Ask the user a clarifying question before proceeding. Use when the prompt is ambiguous.",
        parameters: {
          type: "object",
          properties: {
            question: { type: "string", description: "The question to ask" },
            options: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  question: { type: "string" },
                  choices: { type: "array", items: { type: "string" } },
                  type: { type: "string", enum: ["text", "number", "choice"] },
                  default: {},
                  hint: { type: "string" },
                  allowCustom: { type: "boolean" },
                },
                required: ["id", "question"],
              },
            },
          },
          required: ["question"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_docs",
        description:
          "Search the JSCAD v2 API documentation for functions, examples, and tutorials.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query for JSCAD docs",
            },
            scope: {
              type: "string",
              enum: ["api", "examples", "tutorials", "all"],
              description: "Scope of the search",
            },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "diff_versions",
        description:
          "Compare two versions of the JSCAD code to see what changed.",
        parameters: {
          type: "object",
          properties: {
            fromVersion: {
              type: ["number", "string"],
              description: 'Version number or "previous"',
            },
            toVersion: {
              type: ["number", "string"],
              description: 'Version number or "current"',
            },
          },
          required: ["fromVersion", "toVersion"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "split_components",
        description:
          "Analyze, extract, or merge components in the JSCAD code.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["analyze", "extract", "merge"],
            },
            componentName: {
              type: "string",
              description: "For extract: name of the component to extract",
            },
            functionName: {
              type: "string",
              description: "For extract: name of the new function",
            },
            parameterize: {
              type: "boolean",
              description:
                "For extract: auto-extract constants as parameters",
            },
            components: {
              type: "array",
              items: { type: "string" },
              description: "For merge: component names to merge",
            },
            operation: {
              type: "string",
              enum: ["union", "subtract", "intersect"],
              description: "For merge: boolean operation to apply",
            },
            resultName: {
              type: "string",
              description: "For merge: name of the merged result",
            },
          },
          required: ["action"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "calculate",
        description:
          "Perform mathematical calculations. Supports JavaScript math expressions including constants like Math.PI, Math.sqrt(), trigonometric functions, etc. Useful for computing dimensions, coordinates, angles, and other values needed for 3D modeling.",
        parameters: {
          type: "object",
          properties: {
            expression: {
              type: "string",
              description: "Mathematical expression to evaluate (e.g., '10 * 2 + 5', 'Math.PI * radius * 2', 'Math.sqrt(3)/2 * side')",
            },
          },
          required: ["expression"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "position_relative",
        description:
          "Position one geometry relative to another. Generates the correct translate() code for placement. Use this instead of manually calculating translate coordinates. Supports gear/rack pitch alignment for proper meshing.",
        parameters: {
          type: "object",
          properties: {
            target: {
              type: "string",
              description: "Variable name of the geometry to move/position",
            },
            reference: {
              type: "string",
              description: "Variable name of the reference geometry to position relative to",
            },
            alignment: {
              type: "string",
              enum: ["next_to", "above", "below", "center_on", "pitch_aligned"],
              description: "Type of alignment: next_to (side by side), above/below (stacked), center_on (same center), pitch_aligned (gear/rack meshing)",
            },
            direction: {
              type: "string",
              enum: ["left", "right", "front", "back"],
              description: "For 'next_to' alignment: which side of the reference to place target",
            },
            gap: {
              type: "number",
              description: "Gap between geometries in mm (default: 0). For gears/racks, use 0.1-0.2 for clearance.",
            },
            targetPitchRadius: {
              type: "number",
              description: "For 'pitch_aligned': pitch radius of target geometry. Use module * teeth / 2 for a gear, or 0 for a rack.",
            },
            referencePitchRadius: {
              type: "number",
              description: "For 'pitch_aligned': pitch radius of reference geometry. Use module * teeth / 2 for a gear, or 0 for a rack.",
            },
            targetIsRack: {
              type: "boolean",
              description: "For 'pitch_aligned': set true if target is a rack",
            },
            referenceIsRack: {
              type: "boolean",
              description: "For 'pitch_aligned': set true if reference is a rack (pitch line, not circle)",
            },
            pitchAxis: {
              type: "string",
              enum: ["x", "y"],
              description: "For 'pitch_aligned': axis for center-distance placement. Use 'y' for rack meshes in this library (default), or 'x' for alternate layouts.",
            },
          },
          required: ["target", "reference", "alignment"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "check_alignment",
        description:
          "Verify that two geometries are properly aligned. Checks overlap, touching, or gear/rack pitch meshing. Returns offset distance and alignment status.",
        parameters: {
          type: "object",
          properties: {
            geometryA: {
              type: "string",
              description: "Variable name of the first geometry",
            },
            geometryB: {
              type: "string",
              description: "Variable name of the second geometry",
            },
            checkType: {
              type: "string",
              enum: ["overlap", "touching", "pitch_mesh"],
              description: "Type of alignment check: overlap (share space), touching (adjacent), pitch_mesh (gear/rack meshing)",
            },
            pitchRadiusA: {
              type: "number",
              description: "For 'pitch_mesh': pitch circle radius of geometryA (module * teeth / 2), or 0 if it's a rack",
            },
            pitchRadiusB: {
              type: "number",
              description: "For 'pitch_mesh': pitch circle radius of geometryB, or 0 if it's a rack",
            },
            isRackA: {
              type: "boolean",
              description: "For 'pitch_mesh': true if geometryA is a rack",
            },
            isRackB: {
              type: "boolean",
              description: "For 'pitch_mesh': true if geometryB is a rack",
            },
            pitchAxis: {
              type: "string",
              enum: ["x", "y"],
              description: "For 'pitch_mesh': axis used for center-distance placement (must match position_relative). Default is 'y'.",
            },
          },
          required: ["geometryA", "geometryB", "checkType"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "check_animation_intersections",
        description:
          "Diagnose meshing/intersection and phase errors across animation progress for mechanisms (currently gear-rack). Returns residuals and recommended phase shift.",
        parameters: {
          type: "object",
          properties: {
            mechanismType: {
              type: "string",
              enum: ["gear_rack"],
              description: "Mechanism type to analyze.",
            },
            module: {
              type: "number",
              description: "Gear/rack module in mm.",
            },
            pinionTeeth: {
              type: "number",
              description: "Pinion tooth count.",
            },
            pinionRotationDegPerProgress: {
              type: "number",
              description: "Pinion rotation slope in deg per progress unit (e.g. 360 or -360).",
            },
            rackTranslationMmPerProgress: {
              type: "number",
              description: "Rack translation slope in mm per progress unit, matching your code sign convention.",
            },
            rackXAtProgress0: {
              type: "number",
              description: "Rack X position at progress=0 in mm.",
            },
            userPhaseShiftMm: {
              type: "number",
              description: "Any explicit phase shift term already applied in code (mm).",
            },
            centeredStart: {
              type: "boolean",
              description: "Whether animation intent is centered mesh at progress=0.",
            },
            useLibraryPhaseCompensation: {
              type: "boolean",
              description: "Legacy flag (default false). The gear and rack libraries now mesh directly without phase compensation.",
            },
            gearCenterAxisPosition: {
              type: "number",
              description: "Gear center coordinate along pitch axis (e.g. y value for pitchAxis='y').",
            },
            rackPitchAxisPosition: {
              type: "number",
              description: "Rack pitch-line coordinate along pitch axis (usually 0).",
            },
            meshGap: {
              type: "number",
              description: "Expected radial clearance gap in mm (default 0).",
            },
            pitchAxis: {
              type: "string",
              enum: ["x", "y"],
              description: "Pitch alignment axis used in placement.",
            },
            samples: {
              type: "number",
              description: "Number of progress samples (default 41).",
            },
            tolerance: {
              type: "number",
              description: "Residual tolerance in mm for pass/fail (default 0.02).",
            },
          },
          required: ["module", "pinionTeeth", "pinionRotationDegPerProgress", "rackTranslationMmPerProgress"],
        },
      },
    },
  ];
}

// --- System Prompt ---

function buildSystemPrompt(
  currentCode?: string,
  context?: {
    projectName?: string;
    previousPrompts?: string[];
    parameters?: Record<string, unknown>;
  }
) {
  let prompt = `You are an expert JSCAD v2 3D modeling assistant. You help users create parametric 3D models by writing and editing JSCAD code.

## JSCAD v2 API Quick Reference

### Primitives (require('@jscad/modeling').primitives)
- cuboid({ size: [w,d,h] }), roundedCuboid({ size, roundRadius })
- sphere({ radius, segments }), geodesicSphere({ radius })
- cylinder({ radius, height }), roundedCylinder({ radius, height, roundRadius })
- cylinderElliptic({ startRadius: [rx,ry], endRadius: [rx,ry], height })
- torus({ innerRadius, outerRadius })
- polygon({ points }), polyhedron({ points, faces })

### Booleans (require('@jscad/modeling').booleans)
- union(...geometries), subtract(base, ...cutters), intersect(...geometries)

### Transforms (require('@jscad/modeling').transforms)
- translate([x,y,z], geometry), rotate([rx,ry,rz], geometry), scale([sx,sy,sz], geometry)
- center({ axes: [true,true,true] }, geometry)
- mirror({ normal: [1,0,0] }, geometry)
- align({ modes: ['center','center','min'] }, geometry)

### Extrusions (require('@jscad/modeling').extrusions)
- extrudeLinear({ height }, 2dGeometry)
- extrudeRotate({ angle, segments }, 2dGeometry)
- extrudeRectangular({ size, height }, 2dGeometry)
- extrudeFromSlices({ numberOfSlices, capStart, capEnd, callback }, base)
  - callback MUST return valid slice objects (or null to skip) with non-degenerate edges
  - avoid duplicate consecutive points / zero-scale slices, or JSCAD may throw calculatePlane errors

### Expansions (require('@jscad/modeling').expansions)
- expand({ delta, corners: 'round' }, geometry)
- offset({ delta }, 2dGeometry)

### Colors (require('@jscad/modeling').colors)
- colorize([r,g,b,a], geometry)

### Hulls (require('@jscad/modeling').hulls)
- hull(...geometries), hullChain(...geometries)

## Code Structure
JSCAD scripts must export a \`main\` function:
\`\`\`js
const { cuboid } = require('@jscad/modeling').primitives
const main = () => { return [cuboid({ size: [10, 10, 10] })] }
module.exports = { main }
\`\`\`

Good write_code output (non-parametric):
\`\`\`js
const { cuboid } = require('@jscad/modeling').primitives
function main() {
  return [cuboid({ size: [20, 20, 10] })]
}
module.exports = { main }
\`\`\`

For parametric models, you MUST export \`getParameterDefinitions\` and define \`main(params)\` that uses those params. The UI only shows sliders when \`getParameterDefinitions\` exists, and parameter values only take effect when \`main\` reads the params.

Good write_code output (parametric):
\`\`\`js
const { cuboid } = require('@jscad/modeling').primitives
function getParameterDefinitions() {
  return [
    { name: 'width', type: 'float', initial: 20, caption: 'Width' },
    { name: 'depth', type: 'float', initial: 20, caption: 'Depth' },
    { name: 'height', type: 'float', initial: 10, caption: 'Height' },
  ]
}
function main(params) {
  const { width = 20, depth = 20, height = 10 } = params || {}
  return [cuboid({ size: [width, depth, height] })]
}
module.exports = { main, getParameterDefinitions }
\`\`\`

Parametric examples (correct):
\`\`\`js
const getParameterDefinitions = () => [
  { name: 'radius', type: 'float', initial: 10, caption: 'Radius' },
  { name: 'segments', type: 'int', initial: 32, caption: 'Segments' },
]
const main = (params) => {
  const { radius = 10, segments = 32 } = params || {}
  return [sphere({ radius, segments })]
}
module.exports = { main, getParameterDefinitions }
\`\`\`
\`\`\`js
const getParameterDefinitions = () => [
  { name: 'width', type: 'float', initial: 20, caption: 'Width' },
  { name: 'height', type: 'float', initial: 5, caption: 'Height' },
]
const main = (params) => {
  const { width = 20, height = 5 } = params || {}
  return [roundedCylinder({ radius: width / 2, height, roundRadius: 1, segments: 32 })]
}
module.exports = { main, getParameterDefinitions }
\`\`\`
\`\`\`js
const getParameterDefinitions = () => [
  { name: 'width', type: 'float', initial: 10, caption: 'Width' },
]
const main = (params) => { /* use params.width */ }
module.exports = { main, getParameterDefinitions }
\`\`\`

## Tool Usage Guidelines
1. For initial code generation, use write_code
2. For modifications, ALWAYS use edit_code with targeted diffs — never rewrite the whole file
3. After writing/editing code, diagnostics run automatically — fix any errors
4. Use check_intersection before subtract/intersect to verify geometries overlap
5. Use measure_geometry to verify dimensions match the user's requirements
6. Use ask_user when the prompt is ambiguous — don't guess
7. Use search_docs if unsure about a JSCAD API function
8. Use list_variables to understand the current code structure
9. Use split_components to keep code organized for complex models
10. Use calculate for math calculations (e.g., computing coordinates, dimensions, angles)
11. Use position_relative for placing geometries relative to each other - PREFER this over manual translate() calculations
12. Use check_alignment to verify proper gear/rack meshing before finalizing code
13. Use check_animation_intersections to diagnose gear/rack phase drift and intersection risk across progress
14. Use get_viewport_snapshot when visual verification of the current rendered model would help

## Relative Positioning (IMPORTANT - Use Tools, Not Manual Calculations)

### CRITICAL: Always Use Positioning Tools for Mechanical Elements
When working with gears, racks, or other mechanical elements that mesh together:
- **ALWAYS use position_relative with alignment="pitch_aligned"** - NEVER manually calculate translate() coordinates
- **ALWAYS use check_alignment with checkType="pitch_mesh"** to verify proper meshing
- **ALWAYS use measure_geometry with gearParams/rackParams** to get pitch circle/line info
- For rack meshes in the provided mechanics library, use **pitchAxis="y"** unless the rack is explicitly oriented differently

Manual positioning calculations for gears/racks are error-prone and will result in incorrect meshing. The tools calculate correct center distances based on pitch geometry.

### Gear-Rack Phase Alignment (Library Design)
The provided gear and rack libraries are designed to mesh directly at their reference positions without any additional phase shift:
- **Gear**: The library applies an initial phase offset so a VALLEY (not a tooth) is centered at angle 0 (the Y-axis).
- **Rack**: Teeth are placed starting at x = circularPitch/2, so there is a VALLEY (not a tooth) at x = 0.
- **Result**: When a gear is positioned above a rack with the gear at angle 0 and rack at x=0, the gear's tooth will naturally mesh with the rack's valley at the origin.
- **DO NOT** apply a circularPitch/4 phase shift - this is incorrect for these libraries and will cause misalignment.

### Positioning Geometries Relative to Each Other
Instead of manually calculating translate([x,y,z]) coordinates, use the position_relative tool:

**For gears and racks (pitch-aligned meshing):**
\`\`\`
// Step 1: Create the geometries
include('/jscad-libs/mechanics/gears.jscad')
include('/jscad-libs/mechanics/racks.jscad')
const gear = unwrap(window.jscad.tspi.gear(printerSettings, 40, 8, 6, 1, 20).getModel())
const rack = unwrap(window.jscad.tspi.rack(printerSettings, 100, 8, 1, 20, 20, 0, 2).getModel())

// Step 2: Use position_relative tool with pitch_aligned
// For gear (module=1, teeth=20): pitchRadius = 1 * 20 / 2 = 10mm
// For rack: referenceIsRack = true, pitchRadius = 0
// Tool call: position_relative(target="gear", reference="rack", alignment="pitch_aligned", 
//             targetPitchRadius=10, referenceIsRack=true, pitchAxis="y", gap=0.1)
// Returns: translate([0, 10.1, 0], gear)
// If you need to move the rack instead of the gear:
// position_relative(target="rack", reference="gear", alignment="pitch_aligned",
//                   targetIsRack=true, targetPitchRadius=0, referencePitchRadius=10, pitchAxis="y", gap=0.1)
// Returns: translate([0, -10.1, 0], rack)

// Step 3: Apply the returned translate expression
const positionedGear = translate([0, 10.1, 0], gear)
return [rack, positionedGear]
\`\`\`

**For gear-to-gear meshing:**
\`\`\`
// Two gears: gearA (module=1, teeth=20) and gearB (module=1, teeth=30)
// pitchRadiusA = 10mm, pitchRadiusB = 15mm
// position_relative(target="gearB", reference="gearA", alignment="pitch_aligned",
//                   targetPitchRadius=15, referencePitchRadius=10, pitchAxis="x", gap=0)
// Returns: translate([25, 0, 0], gearB)  // 10 + 15 = 25mm center distance along X
\`\`\`

**For general positioning (next_to, above, below):**
\`\`\`
// Place boxB to the right of boxA with 2mm gap
// position_relative(target="boxB", reference="boxA", alignment="next_to", 
//                   direction="right", gap=2)
// Returns translate expression - you still need to measure geometries to get exact sizes
\`\`\`

### Checking Alignment
Use check_alignment to verify proper meshing before finalizing:

\`\`\`
// Verify gear-rack meshing
check_alignment(geometryA="gear", geometryB="rack", checkType="pitch_mesh",
                pitchRadiusA=10, pitchRadiusB=0, isRackA=false, isRackB=true, pitchAxis="y")
// Returns: expected center distance, alignment verification info
\`\`\`

### Getting Pitch Circle/Line Info
Use measure_geometry with gearParams or rackParams:

\`\`\`
measure_geometry(geometry="gear", gearParams={ module: 1, teeth: 20 })
// Returns: { pitchCircle: { pitchDiameter: 20, pitchRadius: 10, ... } }

measure_geometry(geometry="rack", rackParams={ module: 1 })
// Returns: { pitchLine: { module: 1, description: "..." } }
\`\`\`

### Mechanism Motion Contract (Metadata-First)
For mechanisms, always model motion around one normalized input variable:
- Define one primary motion parameter: \`progress\` in [0, 1].
- Express all part motion as functions of \`progress\` (avoid unsynchronized independent motion sliders).
- The primary mechanism control should always exist in \`getParameterDefinitions()\` with the exact name \`progress\`.
- For diagnostics, additional temporary params may be added, but \`progress\` remains the canonical motion input.
- Prefer pitch-feature metadata from supported libraries (gear/rack helpers) when available.
- If metadata is missing, use autodetection via measurements/known params, and state assumptions when confidence is low.
- For meshing parts (gears/racks), use position_relative + check_alignment and avoid manual translate math.
- For animated meshing diagnostics, use check_animation_intersections to compute residuals and recommended phase shifts.
- Always eliminate phase misalignment before finalizing: run check_animation_intersections, apply the recommended phase correction, and rerun diagnostics until phase residual/misalignment is effectively zero.
- Target behavior: infer relationships from pitch features, solve a feasible shared ROM, then animate only within that solved range.

## External Libraries
- You may load remote helper libraries via include("https://...") for side-effect scripts.
- You may require remote modules via require("https://...") when they export functions.
- GitHub blob URLs are supported and converted to raw URLs.
- Local libraries are available under /jscad-libs/... and can be include()'d.
- Legacy OpenJSCAD v1 libraries can be used by including /jscad-libs/compat/v1.js first.
- Prefer using the provided libraries whenever they cover the requested part/model.
- Available local libraries:
  - /jscad-libs/mechanics/gears.jscad
  - /jscad-libs/mechanics/racks.jscad
- Prefer JSCAD v2-compatible libraries; avoid legacy v1-only CSG libraries unless the user asks for them.

## Preferred Library Usage
- Gears: use the provided library instead of hand-built teeth.
  - include('/jscad-libs/mechanics/gears.jscad') (loads v1 compat automatically).
  - Prefer window.jscad.tspi.gear(printerSettings, diameter, thickness, boreDiameter, module, pressureAngle) for simple gears.
  - This helper is diameter-first and should prioritize matching the requested diameter.
  - Defaults: thickness = 8mm, boreDiameter = 6mm, module = 1mm, pressureAngle = 20deg.
  - Use window.jscad.tspi.involuteGear(printerSettings, params) only for advanced/explicit parameterizations.
  - ALWAYS wrap the return value with unwrap(), then return an array: return [unwrap(gear.getModel())].
  - The unwrap() function is provided by the v1 compat layer and strips non-serializable methods.
  - Minimal example (use param defaults and define params via getParameterDefinitions):
    include('/jscad-libs/mechanics/gears.jscad')
    function main(params) {
      const printerSettings = { scale: 1, correctionInsideDiameter: 0, correctionOutsideDiameter: 0, correctionInsideDiameterMoving: 0, correctionOutsideDiameterMoving: 0, resolutionCircle: 360 }
      const gear = window.jscad.tspi.gear(printerSettings, 40, 8, 6, 1, 20)
      return [unwrap(gear.getModel())]
    }

- Racks: use the new library instead of constructing a straight rack from scratch.
  - include('/jscad-libs/mechanics/racks.jscad') (loads v1 compat automatically).
  - Prefer window.jscad.tspi.rack(printerSettings, length, thickness, module, teethNumber, pressureAngle, clearance, backHeight) to control overall length and tooth count.
  - Defaults: thickness = 8mm, module = 1mm, teethNumber = 20, pressureAngle = 20deg, clearance = 0mm, backHeight = 2mm.
  - If length is positive, it MUST be an exact multiple of circular pitch (module * PI), otherwise the rack helper throws an error.
  - Prefer omitting/zeroing length and controlling size with teethNumber unless you intentionally provide an exact pitch-multiple length.
  - ALWAYS wrap the return value with unwrap(), then return an array: return [unwrap(rack.getModel())].

Good write_code output (gear library):
\`\`\`js
include('/jscad-libs/mechanics/gears.jscad')
function getParameterDefinitions() {
  return [
    { name: 'diameter', type: 'float', initial: 40, caption: 'Gear diameter' },
    { name: 'thickness', type: 'float', initial: 8, caption: 'Thickness' },
    { name: 'boreDiameter', type: 'float', initial: 6, caption: 'Bore diameter' },
    { name: 'module', type: 'float', initial: 1, caption: 'Module' },
    { name: 'pressureAngle', type: 'float', initial: 20, caption: 'Pressure angle' },
  ]
}
function main(params) {
  const { diameter = 40, thickness = 8, boreDiameter = 6, module = 1, pressureAngle = 20 } = params || {}
  const printerSettings = {
    scale: 1,
    correctionInsideDiameter: 0,
    correctionOutsideDiameter: 0,
    correctionInsideDiameterMoving: 0,
    correctionOutsideDiameterMoving: 0,
    resolutionCircle: 360,
  }
  const gear = window.jscad.tspi.gear(printerSettings, diameter, thickness, boreDiameter, module, pressureAngle)
  return [unwrap(gear.getModel())]
}
module.exports = { main, getParameterDefinitions }
\`\`\`

Good write_code output (rack library):
\`\`\`
include('/jscad-libs/mechanics/racks.jscad')
function getParameterDefinitions() {
  return [
    { name: 'length', type: 'float', initial: 0, caption: 'Rack length (0 = use teeth)' },
    { name: 'thickness', type: 'float', initial: 8, caption: 'Thickness' },
    { name: 'module', type: 'float', initial: 1, caption: 'Module' },
    { name: 'teethNumber', type: 'int', initial: 20, caption: 'Teeth count' },
    { name: 'pressureAngle', type: 'float', initial: 20, caption: 'Pressure angle' },
    { name: 'clearance', type: 'float', initial: 0, caption: 'Clearance' },
    { name: 'backHeight', type: 'float', initial: 2, caption: 'Back height' },
  ]
}
function main(params) {
  const { length = 0, thickness = 8, module = 1, teethNumber = 20, pressureAngle = 20, clearance = 0, backHeight = 2 } = params || {}
  const printerSettings = {
    scale: 1,
    correctionInsideDiameter: 0,
    correctionOutsideDiameter: 0,
    correctionInsideDiameterMoving: 0,
    correctionOutsideDiameterMoving: 0,
    resolutionCircle: 360,
  }
  const rack = window.jscad.tspi.rack(printerSettings, length, thickness, module, teethNumber, pressureAngle, clearance, backHeight)
  return [unwrap(rack.getModel())]
}
module.exports = { main, getParameterDefinitions }
\`\`\`

## Tool Enforcement (Critical)
- If the user requests a model, code, or modification, you MUST call the appropriate tool (write_code or edit_code).
- NEVER paste or output full JSCAD code in the assistant message.
- If you do not call a tool, your response must be plain text guidance only (no code blocks).
- When the user says "make" or "create" a model (e.g. "make a gear"), call write_code.

## Important Rules
- Always use require() syntax for JSCAD imports (not ES6 import)
- main() MUST return an array of geometry objects. Even for one shape, return [shape].
- All measurements are in millimeters (mm) by default
- Use segments: 32 for smooth curves (default is often too low)
- Shapes are always CENTERED at 0,0,0 before translation; do NOT place shapes with a corner at the origin
- When scaling a shape, remember you may need to adjust its translation to keep the intended position
- If you destructure params with defaults, use the destructured variables in geometry (do NOT read params.* directly or defaults won't apply)
- ALWAYS use FUNCTION DECLARATIONS (not const/let arrow functions) for helper functions - they must be defined BEFORE main() since JavaScript does not hoist const/let function expressions. Correct: \`function myHelper() {}\`. Incorrect: \`const myHelper = () => {}\`
- Define all helper functions BEFORE the main function
- Explain what you're doing in your text responses
- After making changes, summarize what was modified`;

  if (currentCode) {
    prompt += `\n\n## Current Code\n\`\`\`js\n${currentCode}\n\`\`\``;
  }

  if (context?.projectName) {
    prompt += `\n\nProject: ${context.projectName}`;
  }

  if (context?.previousPrompts?.length) {
    prompt += `\n\nPrevious prompts in this session:\n${context.previousPrompts.map((p, i) => `${i + 1}. ${p}`).join("\n")}`;
  }

  return prompt;
}

// --- Tool Execution ---

function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  currentCode: string,
  context?: ToolRuntimeContext
): ToolResult {
  switch (toolName) {
    case "get_viewport_snapshot": {
      const snapshot = context?.viewportSnapshot;
      if (!snapshot) {
        return {
          output: {
            success: false,
            error: "No viewport snapshot is available in this request. Ask the user to capture or provide one.",
          },
        };
      }

      return {
        output: {
          success: true,
          source: "viewport",
          mimeType: "image/png",
          note: "Viewport snapshot attached as an image for this tool response.",
          altText: snapshot.altText,
        },
      };
    }

    case "write_code":
      {
        const code = args.code as string;
        const hasMain = typeof code === "string" && /module\.exports\s*=\s*\{[^}]*\bmain\b[^}]*\}/.test(code);
        if (!hasMain) {
          return {
            output: {
              success: false,
              error: "write_code must return a full JSCAD module exporting main (and getParameterDefinitions when parametric). Do not return JSON arrays or fragments.",
            },
          };
        }
        return {
          output: { success: true, description: args.description },
          updatedCode: code,
        };
      }

    case "edit_code": {
      let code = currentCode;
      const edits = args.edits as Array<{
        search: string;
        replace: string;
      }>;
      const applied: string[] = [];
      const failed: string[] = [];

      for (const edit of edits) {
        if (code.includes(edit.search)) {
          code = code.replace(edit.search, edit.replace);
          applied.push(edit.search.substring(0, 50));
        } else {
          failed.push(
            `Could not find: "${edit.search.substring(0, 80)}"`
          );
        }
      }

      return {
        output: {
          success: failed.length === 0,
          appliedEdits: applied.length,
          failedEdits: failed,
        },
        updatedCode: code,
      };
    }

    case "read_code":
      return {
        output: {
          code: currentCode,
          lineCount: currentCode.split("\n").length,
        },
      };

    case "get_diagnostics":
      return { output: runDiagnostics(currentCode) };

    case "check_intersection":
      return {
        output: {
          note: "Intersection check requires runtime evaluation. The geometries will be checked when the code is rendered in the browser.",
          geometryA: args.geometryA,
          geometryB: args.geometryB,
          suggestion:
            "Ensure both geometries overlap spatially. Use translate() to position them correctly before applying subtract() or intersect().",
        },
      };

    case "measure_geometry": {
      const output: Record<string, unknown> = {
        note: "Measurement requires runtime evaluation. The geometry will be measured when the code is rendered in the browser.",
        geometry: args.geometry,
        requestedMeasurements: args.measurements || [
          "boundingBox",
          "volume",
          "dimensions",
        ],
      };

      const gearParams = args.gearParams as { module?: number; teeth?: number } | undefined;
      const rackParams = args.rackParams as { module?: number } | undefined;
      const features: Array<Record<string, unknown>> = [];

      if (gearParams && gearParams.module && gearParams.teeth) {
        const pitchDiameter = gearParams.module * gearParams.teeth;
        const pitchRadius = pitchDiameter / 2;
        const circularPitch = gearParams.module * Math.PI;
        output.pitchCircle = {
          module: gearParams.module,
          teeth: gearParams.teeth,
          pitchDiameter,
          pitchRadius,
          description: `Pitch circle: diameter = module * teeth = ${gearParams.module} * ${gearParams.teeth} = ${pitchDiameter}mm. Use this for gear meshing alignment.`,
        };
        output.phaseMetadata = {
          gearLibraryInitialToothPhaseOffsetDegrees: -360 / (4 * gearParams.teeth),
          recommendedRackShiftAtStartMm: 0,
          recommendedRackShiftAtStartPitchFraction: 0,
          description:
            "Both gear and rack libraries are designed to mesh directly at their reference positions (gear: valley at angle 0, rack: valley at x=0). No additional phase shift needed.",
        };
        features.push({
          type: "pitch_circle",
          source: "params",
          module: gearParams.module,
          teethNumber: gearParams.teeth,
          radius: pitchRadius,
          diameter: pitchDiameter,
          circularPitch,
        });
      }

      if (rackParams && rackParams.module) {
        const circularPitch = rackParams.module * Math.PI;
        output.pitchLine = {
          module: rackParams.module,
          description: `Rack pitch line at module height from tooth base. The pitch line is where the gear pitch circle rolls. Use for gear-rack meshing alignment.`,
        };
        features.push({
          type: "pitch_line",
          source: "params",
          module: rackParams.module,
          point: [0, 0, 0],
          direction: [1, 0, 0],
          normal: [0, 1, 0],
          circularPitch,
        });
      }

      if (features.length > 0) {
        output.features = features;
        output.featureSource = "params";
        output.featureConfidence = "medium";
      }

      return { output };
    }

    case "check_printability":
      return {
        output: {
          note: "Printability check requires runtime evaluation.",
          geometry: args.geometry,
          generalTips: [
            "Ensure minimum wall thickness of 0.8mm for FDM printing",
            "Avoid overhangs greater than 45 degrees without supports",
            "Ensure the model is watertight (manifold)",
          ],
        },
      };

    case "list_variables": {
      const varMatches = [
        ...currentCode.matchAll(
          /(?:const|let|var)\s+(\w+)\s*=/g
        ),
      ];
      const variables = varMatches.map((m) => ({
        name: m[1],
        line: currentCode.substring(0, m.index).split("\n").length,
      }));
      return { output: { variables } };
    }

    case "set_parameters": {
      let code = currentCode;
      const params = args.parameters as Record<string, unknown>;
      for (const [key, value] of Object.entries(params)) {
        // Try to find and update parameter defaults
        const patterns = [
          new RegExp(
            `(${key}\\s*(?:=|:)\\s*)([\\d.]+)`,
            "g"
          ),
          new RegExp(
            `(initial:\\s*)([\\d.]+)(.*?name:\\s*'${key}')`,
            "g"
          ),
        ];
        for (const pattern of patterns) {
          code = code.replace(pattern, `$1${value}`);
        }
      }
      return {
        output: { success: true, parametersUpdated: Object.keys(params) },
        updatedCode: code,
      };
    }

    case "ask_user":
      return {
        output: {
          type: "ask_user",
          question: args.question,
          options: args.options,
          waitingForResponse: true,
        },
      };

    case "search_docs":
      return {
        output: searchJscadDocs(
          args.query as string,
          args.scope as string
        ),
      };

    case "diff_versions":
      return {
        output: {
          note: "Version diff requires access to the version history database. This will be resolved client-side.",
          fromVersion: args.fromVersion,
          toVersion: args.toVersion,
        },
      };

    case "split_components": {
      const action = args.action as string;
      if (action === "analyze") {
        const varMatches = [
          ...currentCode.matchAll(
            /(?:const|let|var)\s+(\w+)\s*=\s*(.+?)(?:\n|$)/g
          ),
        ];
        const components = varMatches.map((m) => ({
          name: m[1],
          expression: m[2].trim().substring(0, 60),
          line: currentCode.substring(0, m.index).split("\n").length,
        }));
        return { output: { action: "analyze", components } };
      }
      return {
        output: {
          note: `Component ${action} requires code transformation. The AI should use edit_code to implement this manually.`,
          action,
        },
      };
    }

    case "calculate": {
      const expression = args.expression as string;
      try {
        // Safe evaluation using Function constructor with limited scope
        // Only allow Math functions and basic arithmetic
        const safeEval = new Function("Math", `"use strict"; return (${expression})`);
        const result = safeEval(Math);
        return {
          output: {
            expression,
            result,
            success: true,
          },
        };
      } catch (error) {
        return {
          output: {
            expression,
            error: error instanceof Error ? error.message : String(error),
            success: false,
          },
        };
      }
    }

    case "position_relative": {
      const target = args.target as string;
      const reference = args.reference as string;
      const alignment = args.alignment as string;
      const direction = args.direction as string | undefined;
      const gap = (args.gap as number) ?? 0;
      const targetPitchRadius = args.targetPitchRadius as number | undefined;
      const referencePitchRadius = args.referencePitchRadius as number | undefined;
      const targetIsRack = (args.targetIsRack as boolean) ?? false;
      const referenceIsRack = (args.referenceIsRack as boolean) ?? false;
      const pitchAxis = ((args.pitchAxis as string | undefined) ?? "y") === "x" ? "x" : "y";

      let translateExpr: string;
      let explanation: string;

      switch (alignment) {
        case "next_to": {
          const dir = direction ?? "right";
          const axis = dir === "left" || dir === "right" ? "x" : "y";
          const sign = dir === "right" || dir === "back" ? 1 : -1;
          translateExpr = `translate([${axis === "x" ? `${sign === 1 ? "" : "-"}(refSize[0]/2 + tgtSize[0]/2 + ${gap})` : "0"}, ${axis === "y" ? `${sign === 1 ? "" : "-"}(refSize[1]/2 + tgtSize[1]/2 + ${gap})` : "0"}, 0], ${target})`;
          explanation = `Place ${target} ${dir} of ${reference} with ${gap}mm gap. Requires measuring both geometries first to get exact coordinates.`;
          break;
        }
        case "above": {
          translateExpr = `translate([0, 0, refSize[2]/2 + tgtSize[2]/2 + ${gap}], ${target})`;
          explanation = `Place ${target} above ${reference} (stacked on Z axis) with ${gap}mm gap.`;
          break;
        }
        case "below": {
          translateExpr = `translate([0, 0, -(refSize[2]/2 + tgtSize[2]/2 + ${gap})], ${target})`;
          explanation = `Place ${target} below ${reference} with ${gap}mm gap.`;
          break;
        }
        case "center_on": {
          translateExpr = `translate([0, 0, 0], ${target})`;
          explanation = `${target} and ${reference} will share the same center point.`;
          break;
        }
        case "pitch_aligned": {
          if (targetPitchRadius === undefined) {
            return {
              output: {
                success: false,
                error: "pitch_aligned requires targetPitchRadius (gear: module * teeth / 2, rack: 0)",
              },
            };
          }

          const isGearRack = (targetIsRack && !referenceIsRack) || (!targetIsRack && referenceIsRack);

          if (isGearRack) {
            const gearRadius = targetIsRack ? (referencePitchRadius ?? 0) : targetPitchRadius;
            if (gearRadius <= 0) {
              return {
                output: {
                  success: false,
                  error:
                    "gear-rack pitch_aligned requires the gear pitch radius. If targetIsRack=true, provide referencePitchRadius for the gear.",
                },
              };
            }

            const distance = gearRadius + gap;
            const signedDistance = targetIsRack ? -distance : distance;
            translateExpr =
              pitchAxis === "x"
                ? `translate([${signedDistance.toFixed(3)}, 0, 0], ${target})`
                : `translate([0, ${signedDistance.toFixed(3)}, 0], ${target})`;
            explanation = targetIsRack
              ? `Position rack ${target} below/behind gear ${reference} by ${distance.toFixed(3)}mm so the gear pitch circle touches the rack pitch line along ${pitchAxis.toUpperCase()} axis.`
              : `Position gear ${target} above/in front of rack ${reference} by ${distance.toFixed(3)}mm so the gear pitch circle touches the rack pitch line along ${pitchAxis.toUpperCase()} axis.`;
          } else if (referencePitchRadius !== undefined) {
            const centerDistance = targetPitchRadius + referencePitchRadius + gap;
            translateExpr =
              pitchAxis === "x"
                ? `translate([${centerDistance.toFixed(3)}, 0, 0], ${target})`
                : `translate([0, ${centerDistance.toFixed(3)}, 0], ${target})`;
            explanation = `Position gear ${target} (pitch radius ${targetPitchRadius}mm) to mesh with gear ${reference} (pitch radius ${referencePitchRadius}mm). Center distance = ${centerDistance.toFixed(3)}mm along ${pitchAxis.toUpperCase()} axis.`;
          } else {
            return {
              output: {
                success: false,
                error:
                  "pitch_aligned requires either gear-gear radii (targetPitchRadius + referencePitchRadius) or one side marked as rack (targetIsRack/referenceIsRack).",
              },
            };
          }
          break;
        }
        default:
          return {
            output: {
              success: false,
              error: `Unknown alignment type: ${alignment}`,
            },
          };
      }

      return {
        output: {
          success: true,
          target,
          reference,
          alignment,
          direction,
          gap,
          targetIsRack,
          pitchAxis,
          translateExpression: translateExpr,
          explanation,
          usageNote: "Use this translate expression in your code. For 'next_to', 'above', 'below' alignments, you need to measure geometries first to get exact sizes. For 'pitch_aligned', the coordinates are pre-calculated.",
        },
      };
    }

    case "check_alignment": {
      const geometryA = args.geometryA as string;
      const geometryB = args.geometryB as string;
      const checkType = args.checkType as string;
      const pitchRadiusA = args.pitchRadiusA as number | undefined;
      const pitchRadiusB = args.pitchRadiusB as number | undefined;
      const isRackA = (args.isRackA as boolean) ?? false;
      const isRackB = (args.isRackB as boolean) ?? false;
      const pitchAxis = ((args.pitchAxis as string | undefined) ?? "y") === "x" ? "x" : "y";

      const output: Record<string, unknown> = {
        geometryA,
        geometryB,
        checkType,
        note: "Alignment check requires runtime evaluation of geometry positions.",
      };

      if (checkType === "pitch_mesh") {
        if (pitchRadiusA === undefined || pitchRadiusB === undefined) {
          return {
            output: {
              ...output,
              success: false,
              error: "pitch_mesh check requires pitchRadiusA and pitchRadiusB parameters. For racks, use pitchRadius=0 and set isRackA or isRackB to true.",
            },
          };
        }

        const isGearGear = !isRackA && !isRackB;
        const isGearRack = (!isRackA && isRackB) || (isRackA && !isRackB);

        if (isGearGear) {
          const expectedCenterDistance = pitchRadiusA + pitchRadiusB;
          output.pitchMesh = {
            type: "gear-to-gear",
            gearA: { pitchRadius: pitchRadiusA, isRack: isRackA },
            gearB: { pitchRadius: pitchRadiusB, isRack: isRackB },
            expectedCenterDistance,
            expectedOffsetVector:
              pitchAxis === "x"
                ? [expectedCenterDistance, 0, 0]
                : [0, expectedCenterDistance, 0],
            description: `For proper meshing, center distance should be ${expectedCenterDistance.toFixed(3)}mm (sum of pitch radii) along ${pitchAxis.toUpperCase()} axis. Check that geometries are positioned at this distance.`,
          };
        } else if (isGearRack) {
          const gearRadius = isRackA ? pitchRadiusB : pitchRadiusA;
          output.pitchMesh = {
            type: "gear-to-rack",
            gear: { pitchRadius: gearRadius },
            rack: {
              pitchLine:
                pitchAxis === "x"
                  ? "at x=0 in rack's coordinate system"
                  : "at y=0 in rack's coordinate system",
            },
            expectedDistance: gearRadius,
            expectedOffsetVector:
              pitchAxis === "x" ? [gearRadius, 0, 0] : [0, gearRadius, 0],
            description: `For proper meshing, gear center should be ${gearRadius.toFixed(3)}mm from rack's pitch line along ${pitchAxis.toUpperCase()} axis. The gear's pitch circle should touch the rack's pitch line.`,
          };
        } else {
          output.pitchMesh = {
            type: "rack-to-rack",
            description: "Two racks cannot mesh directly - they need an intermediate gear.",
          };
        }

        output.suggestion = "Use position_relative tool with 'pitch_aligned' to generate correct positioning code, then run check_animation_intersections for animated phase diagnostics.";
      } else if (checkType === "overlap") {
        output.suggestion = "Check that bounding boxes of both geometries intersect. Use measure_geometry to get bounds, then verify overlap.";
      } else if (checkType === "touching") {
        output.suggestion = "Check that geometries are adjacent without gap. Use measure_geometry to get bounds and verify faces are at same coordinate.";
      }

      return { output };
    }

    case "check_animation_intersections": {
      const mechanismType = (args.mechanismType as string | undefined) ?? "gear_rack";
      if (mechanismType !== "gear_rack") {
        return {
          output: {
            success: false,
            error: `Unsupported mechanismType: ${mechanismType}`,
            supportedMechanismTypes: ["gear_rack"],
          },
        };
      }

      const moduleValue = Number(args.module);
      const pinionTeeth = Number(args.pinionTeeth);
      const pinionRotationDegPerProgress = Number(args.pinionRotationDegPerProgress);
      const rackTranslationMmPerProgress = Number(args.rackTranslationMmPerProgress);
      const rackXAtProgress0 = Number((args.rackXAtProgress0 as number | undefined) ?? 0);
      const userPhaseShiftMm = Number((args.userPhaseShiftMm as number | undefined) ?? 0);
      const centeredStart = (args.centeredStart as boolean | undefined) ?? true;
      const useLibraryPhaseCompensation =
        (args.useLibraryPhaseCompensation as boolean | undefined) ?? true;
      const gearCenterAxisPosition = Number((args.gearCenterAxisPosition as number | undefined) ?? 0);
      const rackPitchAxisPosition = Number((args.rackPitchAxisPosition as number | undefined) ?? 0);
      const meshGap = Number((args.meshGap as number | undefined) ?? 0);
      const pitchAxis = ((args.pitchAxis as string | undefined) ?? "y") === "x" ? "x" : "y";
      const samplesRaw = Number((args.samples as number | undefined) ?? 41);
      const samples = Number.isFinite(samplesRaw) ? Math.max(3, Math.min(501, Math.floor(samplesRaw))) : 41;
      const tolerance = Number((args.tolerance as number | undefined) ?? 0.02);

      if (!Number.isFinite(moduleValue) || moduleValue <= 0) {
        return { output: { success: false, error: "module must be a positive number." } };
      }
      if (!Number.isFinite(pinionTeeth) || pinionTeeth <= 0) {
        return { output: { success: false, error: "pinionTeeth must be a positive number." } };
      }
      if (!Number.isFinite(pinionRotationDegPerProgress)) {
        return {
          output: {
            success: false,
            error: "pinionRotationDegPerProgress must be a finite number.",
          },
        };
      }
      if (!Number.isFinite(rackTranslationMmPerProgress)) {
        return {
          output: {
            success: false,
            error: "rackTranslationMmPerProgress must be a finite number.",
          },
        };
      }

      const circularPitch = Math.PI * moduleValue;
      const pitchCircumference = circularPitch * pinionTeeth;
      const pitchRadius = (moduleValue * pinionTeeth) / 2;

      const expectedTranslationMmPerProgress =
        (pinionRotationDegPerProgress / 360) * pitchCircumference;
      const translationResidual =
        rackTranslationMmPerProgress - expectedTranslationMmPerProgress;

      const expectedLibraryPhaseShiftMm = useLibraryPhaseCompensation
        ? 0
        : 0;
      const expectedRackXAtProgress0 = centeredStart
        ? expectedLibraryPhaseShiftMm + userPhaseShiftMm
        : userPhaseShiftMm;
      const phaseResidualAtStart = rackXAtProgress0 - expectedRackXAtProgress0;

      const actualCenterDistance = Math.abs(
        gearCenterAxisPosition - rackPitchAxisPosition
      );
      const expectedCenterDistance = pitchRadius + meshGap;
      const radialResidual = actualCenterDistance - expectedCenterDistance;

      let maxAbsPhaseResidual = -1;
      let worstProgress = 0;
      let worstResidual = 0;
      for (let i = 0; i < samples; i++) {
        const progress = samples === 1 ? 0 : i / (samples - 1);
        const observedRackX = rackXAtProgress0 + rackTranslationMmPerProgress * progress;
        const expectedRackX = expectedRackXAtProgress0 + expectedTranslationMmPerProgress * progress;
        const residual = observedRackX - expectedRackX;
        const absResidual = Math.abs(residual);
        if (absResidual > maxAbsPhaseResidual) {
          maxAbsPhaseResidual = absResidual;
          worstProgress = progress;
          worstResidual = residual;
        }
      }

      const recommendedAdditionalPhaseShiftMm = -phaseResidualAtStart;
      const recommendedAbsolutePhaseShiftMm =
        userPhaseShiftMm + recommendedAdditionalPhaseShiftMm;

      const hasRadialIntersectionRisk = radialResidual < -Math.abs(tolerance);
      const hasKinematicDrift = Math.abs(translationResidual) > Math.abs(tolerance);
      const hasPhaseMisalignment = maxAbsPhaseResidual > Math.abs(tolerance);

      return {
        output: {
          success: true,
          mechanismType,
          pitchAxis,
          pitchModel: {
            module: moduleValue,
            pinionTeeth,
            circularPitch,
            pitchCircumference,
            pitchRadius,
          },
          radialCheck: {
            gearCenterAxisPosition,
            rackPitchAxisPosition,
            expectedCenterDistance,
            actualCenterDistance,
            residual: radialResidual,
            intersectionRisk: hasRadialIntersectionRisk,
          },
          kinematicCheck: {
            pinionRotationDegPerProgress,
            rackTranslationMmPerProgress,
            expectedTranslationMmPerProgress,
            translationResidual,
            samples,
            maxAbsPhaseResidual,
            worstProgress,
            worstResidual,
          },
          phase: {
            centeredStart,
            useLibraryPhaseCompensation,
            expectedLibraryPhaseShiftMm,
            rackXAtProgress0,
            userPhaseShiftMm,
            expectedRackXAtProgress0,
            phaseResidualAtStart,
            recommendedAdditionalPhaseShiftMm,
            recommendedAbsolutePhaseShiftMm,
            recommendedAbsolutePhaseShiftPitchFraction:
              recommendedAbsolutePhaseShiftMm / circularPitch,
          },
          pass: !hasRadialIntersectionRisk && !hasKinematicDrift && !hasPhaseMisalignment,
          tolerance,
          diagnostics: {
            hasRadialIntersectionRisk,
            hasKinematicDrift,
            hasPhaseMisalignment,
          },
          usageNote:
            "Use recommendedAbsolutePhaseShiftMm as your phase offset term, then keep rack/gear driven by one normalized progress parameter.",
        },
      };
    }

    default:
      return { output: { error: `Unknown tool: ${toolName}` } };
  }
}

// --- Diagnostics ---

const localLibsRoot = path.resolve(process.cwd(), "public", "jscad-libs");

function normalizeRemoteUrl(url: string) {
  const match = url.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/
  );
  if (match) {
    return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}/${match[4]}`;
  }
  return url;
}

function isRemoteSpec(spec: string) {
  return spec.startsWith("http://") || spec.startsWith("https://");
}

function isLocalSpec(spec: string) {
  return spec.startsWith("/jscad-libs/") || spec.startsWith("jscad-libs/");
}

function normalizeLocalSpec(spec: string) {
  return spec.startsWith("/") ? spec : `/${spec}`;
}

function toLocalPath(spec: string) {
  const normalized = normalizeLocalSpec(spec).replace(/^\/jscad-libs\//, "");
  const resolved = path.resolve(localLibsRoot, normalized);
  if (!resolved.startsWith(localLibsRoot)) {
    throw new Error(`Local module path escapes library root: ${spec}`);
  }
  return resolved;
}

function toLocalModuleId(spec: string) {
  return `file://${toLocalPath(spec)}`;
}

function resolveModuleSpec(baseId: string | undefined, spec: string) {
  if (isRemoteSpec(spec)) return normalizeRemoteUrl(spec);
  if (isLocalSpec(spec)) return toLocalModuleId(spec);

  if (spec.startsWith("./") || spec.startsWith("../")) {
    if (!baseId) return spec;
    if (baseId.startsWith("file://")) {
      const basePath = baseId.replace("file://", "");
      return `file://${path.resolve(path.dirname(basePath), spec)}`;
    }
    return normalizeRemoteUrl(new URL(spec, baseId).toString());
  }

  return spec;
}

function extractModuleSpecs(code: string) {
  const specs: string[] = [];
  const regex = /\b(?:require|include)\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(code))) {
    const spec = match[1].trim();
    if (isRemoteSpec(spec) || isLocalSpec(spec)) {
      specs.push(spec);
    } else if (spec.startsWith("./") || spec.startsWith("../")) {
      specs.push(spec);
    }
  }
  return specs;
}

async function preloadExternalModules(code: string) {
  const sources = new Map<string, string>();
  const queue: Array<{ spec: string; baseId?: string }> = [];

  for (const spec of extractModuleSpecs(code)) {
    if (isRemoteSpec(spec) || isLocalSpec(spec)) queue.push({ spec });
  }

  while (queue.length > 0) {
    const entry = queue.shift();
    if (!entry) continue;
    const resolved = resolveModuleSpec(entry.baseId, entry.spec);

    if (sources.has(resolved)) continue;

    let text: string;
    if (resolved.startsWith("file://")) {
      text = await readFile(resolved.replace("file://", ""), "utf8");
    } else {
      const response = await fetch(resolved);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch remote module: ${resolved} (${response.status})`
        );
      }
      text = await response.text();
    }

    sources.set(resolved, text);

    for (const spec of extractModuleSpecs(text)) {
      if (isRemoteSpec(spec) || isLocalSpec(spec)) {
        queue.push({ spec });
      } else if (spec.startsWith("./") || spec.startsWith("../")) {
        queue.push({ spec, baseId: resolved });
      }
    }
  }

  return sources;
}

async function runJscadRuntime(
  code: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const jscad = await import("@jscad/modeling");
    const remoteModuleSources = await preloadExternalModules(code);
    const remoteModuleCache = new Map<string, { exports: Record<string, unknown> }>();
    const evaluating = new Set<string>();
    const runtimeGlobal = globalThis as unknown as Record<string, unknown>;
    const existingWindow = runtimeGlobal.window;
    const runtimeWindow =
      existingWindow && typeof existingWindow === "object"
        ? (existingWindow as Record<string, unknown>)
        : {};
    runtimeGlobal.window = runtimeWindow;
    if (!("location" in runtimeWindow)) {
      runtimeWindow.location = { protocol: "https:", origin: "https://localhost" };
    }

    const evaluateRemoteModule = (
      spec: string,
      baseId?: string
    ): Record<string, unknown> => {
      const normalized = resolveModuleSpec(baseId, spec);
      const cached = remoteModuleCache.get(normalized);
      if (cached) return cached.exports;
      if (evaluating.has(normalized)) {
        throw new Error(`Circular remote module reference: ${normalized}`);
      }

      const source = remoteModuleSources.get(normalized);
      if (!source) {
        throw new Error(`External module not preloaded: ${normalized}`);
      }

      evaluating.add(normalized);
      const remoteModule = { exports: {} as Record<string, unknown> };
      remoteModuleCache.set(normalized, remoteModule);

      const localRequire = (path: string) => {
        if (path === "@jscad/modeling") return jscad;
        if (path.startsWith("@jscad/modeling/")) {
          const subpath = path.replace("@jscad/modeling/", "");
          const parts = subpath.split("/");
          let result: unknown = jscad as Record<string, unknown>;
          for (const part of parts) {
            result = (result as Record<string, unknown>)?.[part];
          }
          return result;
        }
        if (isRemoteSpec(path) || isLocalSpec(path)) {
          return evaluateRemoteModule(path);
        }
        if (path.startsWith("./") || path.startsWith("../")) {
          return evaluateRemoteModule(path, normalized);
        }
        throw new Error(`Unknown module: ${path}`);
      };

      const include = (path: string) => {
        if (!path) return;
        if (isRemoteSpec(path) || isLocalSpec(path)) {
          evaluateRemoteModule(path);
          return;
        }
        if (path.startsWith("./") || path.startsWith("../")) {
          evaluateRemoteModule(path, normalized);
          return;
        }
        throw new Error(`include() requires a remote URL or /jscad-libs path: ${path}`);
      };

      const fn = new Function(
        "require",
        "module",
        "exports",
        "include",
        "window",
        source
      );
      fn(localRequire, remoteModule, remoteModule.exports, include, runtimeGlobal.window);
      evaluating.delete(normalized);
      return remoteModule.exports;
    };

    const mockRequire = (path: string) => {
      if (path === "@jscad/modeling") return jscad;
      if (path.startsWith("@jscad/modeling/")) {
        const subpath = path.replace("@jscad/modeling/", "");
        const parts = subpath.split("/");
        let result: unknown = jscad as Record<string, unknown>;
        for (const part of parts) {
          result = (result as Record<string, unknown>)?.[part];
        }
        return result;
      }
      if (isRemoteSpec(path) || isLocalSpec(path)) {
        return evaluateRemoteModule(path);
      }
      throw new Error(`Unknown module: ${path}`);
    };

    const include = (path: string) => {
      if (!path) return;
      if (isRemoteSpec(path) || isLocalSpec(path)) {
        evaluateRemoteModule(path);
        return;
      }
      throw new Error(`include() requires a remote URL or /jscad-libs path: ${path}`);
    };

    const cjsModule = { exports: {} as Record<string, unknown> };
    const fn = new Function("require", "module", "exports", "include", code);
    fn(mockRequire, cjsModule, cjsModule.exports, include);

    const exports = cjsModule.exports as {
      main?: (params?: Record<string, unknown>) => unknown;
      getParameterDefinitions?: () => Array<{
        name?: string;
        initial?: unknown;
        default?: unknown;
      }>;
    };

    if (typeof exports.main !== "function") {
      return { ok: false, error: "No main() function exported" };
    }

    let runtimeParams: Record<string, unknown> = {};
    if (typeof exports.getParameterDefinitions === "function") {
      const definitions = exports.getParameterDefinitions();
      if (Array.isArray(definitions)) {
        runtimeParams = definitions.reduce<Record<string, unknown>>(
          (acc, def) => {
            if (!def || typeof def !== "object") return acc;
            const name = def.name;
            if (!name) return acc;
            if (def.initial !== undefined) {
              acc[name] = def.initial;
            } else if (def.default !== undefined) {
              acc[name] = def.default;
            }
            return acc;
          },
          {}
        );
      }
    }

    const mainResult = exports.main(runtimeParams);
    if (!Array.isArray(mainResult)) {
      return {
        ok: false,
        error:
          "main() must return an array of geometry objects, even when returning a single object.",
      };
    }
    if (mainResult.length === 0) {
      return {
        ok: false,
        error: "main() returned an empty array. Return at least one geometry object.",
      };
    }
    const hasInvalidGeometry = mainResult.some(
      (item) => !item || typeof item !== "object"
    );
    if (hasInvalidGeometry) {
      return {
        ok: false,
        error: "main() array contains invalid entries. Each entry must be a geometry object.",
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function runDiagnostics(code: string): {
  diagnostics: DiagnosticItem[];
  errors: number;
  warnings: number;
  info: number;
} {
  const diagnostics: DiagnosticItem[] = [];

  // Check for common JSCAD issues
  if (!code.includes("module.exports")) {
    diagnostics.push({
      severity: "error",
      line: 1,
      message:
        "Missing module.exports. JSCAD scripts must export { main } or { main, getParameterDefinitions }.",
      source: "jscad-validator",
      code: "MISSING_EXPORTS",
    });
  }

  if (!code.includes("main")) {
    diagnostics.push({
      severity: "error",
      line: 1,
      message: "Missing main function. JSCAD scripts must define a main() function.",
      source: "jscad-validator",
      code: "MISSING_MAIN",
    });
  }

  // Check for v1 API usage
  const v1Patterns = [
    {
      pattern: /CSG\./g,
      message: "Using deprecated JSCAD v1 API (CSG.*). Use @jscad/modeling instead.",
    },
    {
      pattern: /OpenJsCad/g,
      message: "Using deprecated OpenJsCad reference. Use @jscad/modeling instead.",
    },
    {
      pattern: /cube\(\{/g,
      message: "cube() is deprecated in v2. Use cuboid() instead.",
    },
  ];

  for (const { pattern, message } of v1Patterns) {
    const matches = [...code.matchAll(pattern)];
    for (const match of matches) {
      const line = code.substring(0, match.index).split("\n").length;
      diagnostics.push({
        severity: "warning",
        line,
        message,
        source: "api-checker",
        code: "DEPRECATED_API",
      });
    }
  }

  // Check for high segment counts
  const segmentMatch = code.match(/segments:\s*(\d+)/);
  if (segmentMatch && parseInt(segmentMatch[1]) > 64) {
    const line = code.substring(0, segmentMatch.index).split("\n").length;
    diagnostics.push({
      severity: "warning",
      line,
      message: `High segment count (${segmentMatch[1]}) may cause slow rendering. Consider using 32-48 for most cases.`,
      source: "geometry-analyzer",
      code: "HIGH_SEGMENTS",
    });
  }

  // Check for import statements instead of require
  if (code.includes("import ") && code.includes("from '@jscad")) {
    diagnostics.push({
      severity: "error",
      line: 1,
      message:
        "JSCAD v2 uses require() syntax, not ES6 imports. Use: const { ... } = require('@jscad/modeling')...",
      source: "jscad-validator",
      code: "ES6_IMPORT",
    });
  }

  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;
  const info = diagnostics.filter((d) => d.severity === "info").length;

  return { diagnostics, errors, warnings, info };
}

// --- Docs Search (simplified in-memory) ---

function searchJscadDocs(query: string, scope?: string) {
  const docs = [
    {
      module: "modeling/primitives",
      functions: [
        "cuboid",
        "roundedCuboid",
        "sphere",
        "geodesicSphere",
        "cylinder",
        "roundedCylinder",
        "cylinderElliptic",
        "torus",
        "polygon",
        "polyhedron",
        "circle",
        "ellipse",
        "rectangle",
        "roundedRectangle",
        "square",
        "star",
        "triangle",
        "arc",
        "line",
      ],
    },
    {
      module: "modeling/booleans",
      functions: ["union", "subtract", "intersect", "scission"],
    },
    {
      module: "modeling/transforms",
      functions: [
        "translate",
        "translateX",
        "translateY",
        "translateZ",
        "rotate",
        "rotateX",
        "rotateY",
        "rotateZ",
        "scale",
        "scaleX",
        "scaleY",
        "scaleZ",
        "center",
        "centerX",
        "centerY",
        "centerZ",
        "mirror",
        "mirrorX",
        "mirrorY",
        "mirrorZ",
        "align",
      ],
    },
    {
      module: "modeling/extrusions",
      functions: [
        "extrudeLinear",
        "extrudeRotate",
        "extrudeRectangular",
        "extrudeHelical",
        "extrudeFromSlices",
        "project",
      ],
    },
    {
      module: "modeling/expansions",
      functions: ["expand", "offset"],
    },
    {
      module: "modeling/hulls",
      functions: ["hull", "hullChain"],
    },
    {
      module: "modeling/colors",
      functions: [
        "colorize",
        "colorNameToRgb",
        "hexToRgb",
        "hslToRgb",
        "hsvToRgb",
      ],
    },
    {
      module: "modeling/measurements",
      functions: [
        "measureBoundingBox",
        "measureBoundingSphere",
        "measureVolume",
        "measureArea",
        "measureCenter",
        "measureCenterOfMass",
        "measureDimensions",
      ],
    },
    {
      module: "modeling/text",
      functions: ["vectorText", "vectorChar"],
    },
    {
      module: "modeling/curves/bezier",
      functions: ["create", "valueAt", "tangentAt", "length", "arcLengthToT"],
    },
  ];

  const queryLower = query.toLowerCase();
  const results = [];

  for (const doc of docs) {
    if (scope && scope !== "all" && scope !== "api") continue;

    for (const fn of doc.functions) {
      if (
        fn.toLowerCase().includes(queryLower) ||
        doc.module.toLowerCase().includes(queryLower)
      ) {
        results.push({
          source: "api",
          module: doc.module,
          function: fn,
          usage: `const { ${fn} } = require('@jscad/modeling').${doc.module.split("/").pop()}`,
          url: `https://openjscad.xyz/docs/module-${doc.module.replace(/\//g, "_")}.html#.${fn}`,
        });
      }
    }
  }

  return { results: results.slice(0, 10), totalResults: results.length };
}
