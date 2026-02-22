import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "bun:test";

test("codegen router includes animation phase diagnostic tool", () => {
  const filePath = resolve(process.cwd(), "src/server/routers/codegen.ts");
  const content = readFileSync(filePath, "utf8");

  expect(content).toContain('name: "check_animation_intersections"');
  expect(content).toContain('case "check_animation_intersections"');
  expect(content).toContain("recommendedAbsolutePhaseShiftMm");
});
