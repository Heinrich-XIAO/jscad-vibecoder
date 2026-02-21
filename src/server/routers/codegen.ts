import { z } from "zod";
import path from "path";
import { readFile } from "fs/promises";
import { router, publicProcedure } from "../trpc";
import { getOpenRouterEndpoint } from "@/lib/openrouter";

export const generateInputSchema = z.object({
  prompt: z.string(),
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
 * and the 14-tool agent system for JSCAD vibecoding.
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
  content?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

function parseModelSpec(model: string) {
  const match = model.match(/\|reasoning=(low|high)$/);
  if (!match) {
    return { model, reasoning: undefined } as const;
  }

  const effort = match[1] as "low" | "high";
  const baseModel = model.replace(/\|reasoning=(low|high)$/, "");
  return { model: baseModel, reasoning: { effort } } as const;
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
    currentCode,
    projectContext,
    openRouterApiKey,
    model,
    maxIterations,
  } = input;

  const apiKey =
    openRouterApiKey?.trim() || process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "OpenRouter API key is missing. Please configure it in Settings or on the server."
    );
  }

  const { model: resolvedModel, reasoning } = parseModelSpec(model);

  const tools = buildToolDefinitions();
  const systemPrompt = buildSystemPrompt(currentCode, projectContext);

  const messages: OpenRouterMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ];

  const toolResults: ToolCallRecord[] = [];
  let finalCode = currentCode || "";
  let iterations = 0;
  let pendingRuntimeError: string | null = null;
  let pendingDiagnosticsErrors = 0;

  while (iterations < maxIterations) {
    iterations++;
    await onEvent?.({ type: "iteration_started", iteration: iterations });

    const response = await callOpenRouter({
      apiKey,
      model: resolvedModel,
      messages,
      tools,
      reasoning,
    });

    const assistantMessage = response.choices[0]?.message;
    if (!assistantMessage) break;

    messages.push(assistantMessage);

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      if (pendingRuntimeError || pendingDiagnosticsErrors > 0) {
        messages.push({
          role: "system",
          content:
            "You must fix the outstanding runtime/diagnostic errors before responding. Use edit_code to correct the code.",
        });
        continue;
      }

      if (assistantMessage.content) {
        await onEvent?.({ type: "assistant_message", content: assistantMessage.content });
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

      const result = executeToolCall(toolCall.function.name, args, finalCode);

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

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(toolOutput),
      });
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
        model: resolvedModel,
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
          "Provide a final response to the user. Do not call tools. Summarize what you did and what happened.",
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
        max_tokens: 4096,
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
        max_tokens: 4096,
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
          "Measure properties of a named geometry (bounding box, volume, surface area, etc.).",
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
const main = () => { return cuboid({ size: [10, 10, 10] }) }
module.exports = { main }
\`\`\`

Good write_code output (non-parametric):
\`\`\`js
const { cuboid } = require('@jscad/modeling').primitives
function main() {
  return cuboid({ size: [20, 20, 10] })
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
  return cuboid({ size: [width, depth, height] })
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
  return sphere({ radius, segments })
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
  return roundedCylinder({ radius: width / 2, height, roundRadius: 1, segments: 32 })
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

## External Libraries
- You may load remote helper libraries via include("https://...") for side-effect scripts.
- You may require remote modules via require("https://...") when they export functions.
- GitHub blob URLs are supported and converted to raw URLs.
- Local libraries are available under /jscad-libs/... and can be include()'d.
- Legacy OpenJSCAD v1 libraries can be used by including /jscad-libs/compat/v1.js first.
- Prefer using the provided libraries whenever they cover the requested part/model.
- Available local libraries:
  - /jscad-libs/mechanics/airfoilNaca.jscad
  - /jscad-libs/mechanics/aluprofile.jscad
  - /jscad-libs/mechanics/basicSplitWall.jscad
  - /jscad-libs/mechanics/bearingLM8LUU.jscad
  - /jscad-libs/mechanics/bearingLM8UU.jscad
  - /jscad-libs/mechanics/bearingblockSMAUU.jscad
  - /jscad-libs/mechanics/cfflange.jscad
  - /jscad-libs/mechanics/gears.jscad
  - /jscad-libs/mechanics/racks.jscad
  - /jscad-libs/mechanics/isothread.jscad
  - /jscad-libs/mechanics/motedisDelrin.jscad
  - /jscad-libs/mechanics/motedisKFL08.jscad
  - /jscad-libs/mechanics/motorElectric_Unknown1.jscad
  - /jscad-libs/mechanics/screwclamp.jscad
  - /jscad-libs/mechanics/servoSG90.jscad
  - /jscad-libs/mechanics/stepper28byj_48.jscad
  - /jscad-libs/mechanics/stepperNema17.jscad
  - /jscad-libs/electronics/connectors/M24308_4.jscad
  - /jscad-libs/electronics/embedded/raspberrypibplus.jscad
  - /jscad-libs/electronics/forkedlightbarrier/hy86n.jscad
  - /jscad-libs/electronics/lasermodule/001_405_20W.jscad
  - /jscad-libs/electronics/lasermodule/tocan.jscad
  - /jscad-libs/electronics/ultrasonicsensors/hcsr04.jscad
- Prefer JSCAD v2-compatible libraries; avoid legacy v1-only CSG libraries unless the user asks for them.

## Preferred Library Usage
- Gears: use the provided library instead of hand-built teeth.
  - include('/jscad-libs/mechanics/gears.jscad') (loads v1 compat automatically).
  - Prefer window.jscad.tspi.gear(printerSettings, diameter, thickness, boreDiameter, module, pressureAngle) for simple gears.
  - This helper is diameter-first and should prioritize matching the requested diameter.
  - Defaults: thickness = 8mm, boreDiameter = 6mm, module = 1mm, pressureAngle = 20deg.
  - Use window.jscad.tspi.involuteGear(printerSettings, params) only for advanced/explicit parameterizations.
  - ALWAYS wrap the return value with unwrap(): return unwrap(gear.getModel()).
  - The unwrap() function is provided by the v1 compat layer and strips non-serializable methods.
  - Minimal example (use param defaults and define params via getParameterDefinitions):
    include('/jscad-libs/mechanics/gears.jscad')
    function main(params) {
      const printerSettings = { scale: 1, correctionInsideDiameter: 0, correctionOutsideDiameter: 0, correctionInsideDiameterMoving: 0, correctionOutsideDiameterMoving: 0, resolutionCircle: 360 }
      const gear = window.jscad.tspi.gear(printerSettings, 40, 8, 6, 1, 20)
      return unwrap(gear.getModel())
    }

- Racks: use the new library instead of constructing a straight rack from scratch.
  - include('/jscad-libs/mechanics/racks.jscad') (loads v1 compat automatically).
  - Prefer window.jscad.tspi.rack(printerSettings, length, thickness, module, teethNumber, pressureAngle, clearance, backHeight) to control overall length and tooth count.
  - Defaults: length = 100mm (when length is supplied), thickness = 8mm, module = 1mm, teethNumber = 20, pressureAngle = 20deg, clearance = 0mm, backHeight = 2mm.
  - Supplying a positive length lets the helper compute a matching tooth count; omit length to fix the count via teethNumber.
  - ALWAYS wrap the return value with unwrap(): return unwrap(rack.getModel()).

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
  return unwrap(gear.getModel())
}
module.exports = { main, getParameterDefinitions }
\`\`\`

Good write_code output (rack library):
\`\`\`
include('/jscad-libs/mechanics/racks.jscad')
function getParameterDefinitions() {
  return [
    { name: 'length', type: 'float', initial: 100, caption: 'Rack length' },
    { name: 'thickness', type: 'float', initial: 8, caption: 'Thickness' },
    { name: 'module', type: 'float', initial: 1, caption: 'Module' },
    { name: 'teethNumber', type: 'int', initial: 20, caption: 'Teeth count' },
    { name: 'pressureAngle', type: 'float', initial: 20, caption: 'Pressure angle' },
    { name: 'clearance', type: 'float', initial: 0, caption: 'Clearance' },
    { name: 'backHeight', type: 'float', initial: 2, caption: 'Back height' },
  ]
}
function main(params) {
  const { length = 100, thickness = 8, module = 1, teethNumber = 20, pressureAngle = 20, clearance = 0, backHeight = 2 } = params || {}
  const printerSettings = {
    scale: 1,
    correctionInsideDiameter: 0,
    correctionOutsideDiameter: 0,
    correctionInsideDiameterMoving: 0,
    correctionOutsideDiameterMoving: 0,
    resolutionCircle: 360,
  }
  const rack = window.jscad.tspi.rack(printerSettings, length, thickness, module, teethNumber, pressureAngle, clearance, backHeight)
  return unwrap(rack.getModel())
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
  currentCode: string
): ToolResult {
  switch (toolName) {
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

    case "measure_geometry":
      return {
        output: {
          note: "Measurement requires runtime evaluation. The geometry will be measured when the code is rendered in the browser.",
          geometry: args.geometry,
          requestedMeasurements: args.measurements || [
            "boundingBox",
            "volume",
            "dimensions",
          ],
        },
      };

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

    exports.main(runtimeParams);
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
