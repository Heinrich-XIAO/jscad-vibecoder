import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "bun:test";

test("jscad worker injects base origin for local includes", () => {
  const filePath = resolve(process.cwd(), "src/lib/jscad-worker.ts");
  const content = readFileSync(filePath, "utf8");

  expect(content).toContain("injectedBaseOrigin");
  expect(content).toContain("new URL(normalized, baseOrigin)");
  expect(content).toContain("path.startsWith('/jscad-libs/')");
});
