import { z } from "zod";
import { router, publicProcedure } from "../trpc";

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
    .input(
      z.object({
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
        model: z.string().default("z-ai/glm-4.7"),
        maxIterations: z.number().default(5),
      })
    )
    .mutation(async ({ input }) => {
      const {
        prompt,
        currentCode,
        projectContext,
        openRouterApiKey,
        model,
        maxIterations,
      } = input;

      const apiKey = openRouterApiKey || process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error(
          "OpenRouter API key is missing. Please configure it in Settings or on the server."
        );
      }

      const tools = buildToolDefinitions();
      const systemPrompt = buildSystemPrompt(currentCode, projectContext);

      const messages: OpenRouterMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ];

      const toolResults: ToolCallRecord[] = [];
      let finalCode = currentCode || "";
      let iterations = 0;

      // Agent loop: call LLM, execute tool calls, feed results back
      while (iterations < maxIterations) {
        iterations++;

        const response = await callOpenRouter({
          apiKey,
          model,
          messages,
          tools,
        });

        const assistantMessage = response.choices[0]?.message;
        if (!assistantMessage) break;

        messages.push(assistantMessage);

        // If no tool calls, the AI is done
        if (
          !assistantMessage.tool_calls ||
          assistantMessage.tool_calls.length === 0
        ) {
          break;
        }

        // Execute each tool call
        for (const toolCall of assistantMessage.tool_calls) {
          let args;
          let parseError: string | null = null;
          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch (e: unknown) {
            parseError = e instanceof Error ? e.message : String(e);
            console.error("Failed to parse tool arguments:", toolCall.function.arguments);
            args = {};
          }
          
          let result;
          let shouldRetry = false;
          
          if (parseError) {
            // If JSON parsing failed, tell the AI to retry with valid JSON
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({
                error: `JSON parsing failed: ${parseError}. The arguments were: ${toolCall.function.arguments}. Please retry with valid JSON format for the ${toolCall.function.name} tool.`,
              }),
            });
            shouldRetry = true;
          } else {
            result = executeToolCall(
              toolCall.function.name,
              args,
              finalCode
            );

            // Update code if the tool modified it
            if (result.updatedCode !== undefined) {
              finalCode = result.updatedCode;
            }

            toolResults.push({
              toolName: toolCall.function.name,
              args,
              result: result.output,
            });

            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify(result.output),
            });
          }
          
          // If there was a parse error, continue to next iteration to let AI retry
          if (shouldRetry) {
            continue;
          }
        }

        // After tool execution, run auto-diagnostics if code changed
        const lastToolNames = (assistantMessage.tool_calls || []).map(
          (tc: { function: { name: string } }) => tc.function.name
        );
        if (
          lastToolNames.includes("edit_code") ||
          lastToolNames.includes("write_code")
        ) {
          const diagnostics = runDiagnostics(finalCode);
          if (diagnostics.errors > 0) {
            messages.push({
              role: "system",
              content: `Auto-diagnostics detected ${diagnostics.errors} error(s):\n${JSON.stringify(diagnostics.diagnostics, null, 2)}\nPlease fix these issues.`,
            });
          }
        }
      }

      return {
        code: finalCode,
        toolResults,
        iterations,
        assistantMessage:
          messages[messages.length - 1]?.role === "assistant"
            ? (messages[messages.length - 1] as { content?: string })?.content
            : undefined,
      };
    }),
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

interface ToolCallRecord {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
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

async function callOpenRouter(params: {
  apiKey: string;
  model: string;
  messages: OpenRouterMessage[];
  tools: unknown[];
}) {
  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://jscad-vibe.app",
        "X-Title": "JSCAD Vibe",
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        tools: params.tools,
        tool_choice: "auto",
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

For parametric models, also export \`getParameterDefinitions\`:
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

## Important Rules
- Always use require() syntax for JSCAD imports (not ES6 import)
- All measurements are in millimeters (mm) by default
- Use segments: 32 for smooth curves (default is often too low)
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
      return {
        output: { success: true, description: args.description },
        updatedCode: args.code as string,
      };

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

    default:
      return { output: { error: `Unknown tool: ${toolName}` } };
  }
}

// --- Diagnostics ---

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
