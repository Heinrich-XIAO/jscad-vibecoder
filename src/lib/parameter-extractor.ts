/**
 * Extracts parameter definitions from JSCAD code by parsing the
 * getParameterDefinitions function.
 */

export interface ExtractedParameter {
  name: string;
  type: "number" | "text" | "choice" | "boolean";
  value: unknown;
  initial?: unknown;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  choices?: string[];
}

/**
 * Extract parameters from JSCAD code by analyzing the getParameterDefinitions function
 * and default values in destructuring patterns.
 */
export function extractParameters(code: string): ExtractedParameter[] {
  const params: ExtractedParameter[] = [];

  // Try to find getParameterDefinitions
  const paramDefMatch = code.match(
    /getParameterDefinitions\s*(?:=\s*\(\)\s*=>|.*?function\s*\(\))\s*(?:=>)?\s*\[([^]*?)\]/
  );

  if (paramDefMatch) {
    // Parse the array of parameter definition objects
    const content = paramDefMatch[1];
    const objectMatches = content.matchAll(
      /\{([^}]+)\}/g
    );

    for (const match of objectMatches) {
      const obj = match[1];

      const name = obj.match(/name:\s*['"](\w+)['"]/)?.[1];
      const type = obj.match(/type:\s*['"](\w+)['"]/)?.[1];
      const initial = obj.match(/initial:\s*([^,}\s]+)/)?.[1];
      const caption = obj.match(/caption:\s*['"]([^'"]+)['"]/)?.[1];
      const min = obj.match(/min:\s*([^,}\s]+)/)?.[1];
      const max = obj.match(/max:\s*([^,}\s]+)/)?.[1];
      const step = obj.match(/step:\s*([^,}\s]+)/)?.[1];

      if (name) {
        let paramType: ExtractedParameter["type"] = "number";
        let value: unknown = 0;

        switch (type) {
          case "float":
          case "int":
          case "number":
            paramType = "number";
            value = initial ? parseFloat(initial) : 0;
            break;
          case "text":
            paramType = "text";
            value = initial?.replace(/['"]/g, "") || "";
            break;
          case "checkbox":
            paramType = "boolean";
            value = initial === "true";
            break;
          case "choice":
            paramType = "choice";
            value = initial?.replace(/['"]/g, "") || "";
            break;
          default:
            paramType = "number";
            value = initial ? parseFloat(initial) : 0;
        }

        params.push({
          name,
          type: paramType,
          value,
          min: min ? parseFloat(min) : undefined,
          max: max ? parseFloat(max) : undefined,
          step: step ? parseFloat(step) : type === "int" ? 1 : 0.1,
          label: caption || name,
        });
      }
    }
  }

  // Fallback: try to find destructured defaults in main function
  if (params.length === 0) {
    const destructureMatch = code.match(
      /(?:const|let)\s*\{([^}]+)\}\s*=\s*(?:params|parameters)\s*\|\|\s*\{?\}?/
    );
    if (destructureMatch) {
      const assignments = destructureMatch[1].matchAll(
        /(\w+)\s*=\s*([^,}]+)/g
      );
      for (const [, name, defaultValue] of assignments) {
        const trimmed = defaultValue.trim();
        const numValue = parseFloat(trimmed);

        if (!isNaN(numValue)) {
          params.push({
            name,
            type: "number",
            value: numValue,
            label: name.replace(/([A-Z])/g, " $1").trim(),
            step: Number.isInteger(numValue) ? 1 : 0.1,
          });
        } else if (trimmed === "true" || trimmed === "false") {
          params.push({
            name,
            type: "boolean",
            value: trimmed === "true",
            label: name.replace(/([A-Z])/g, " $1").trim(),
          });
        } else {
          params.push({
            name,
            type: "text",
            value: trimmed.replace(/['"]/g, ""),
            label: name.replace(/([A-Z])/g, " $1").trim(),
          });
        }
      }
    }
  }

  return params;
}
