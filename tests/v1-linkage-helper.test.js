import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { expect, test } from "bun:test";

const require = createRequire(import.meta.url);

function evalLib(filePath) {
  const code = readFileSync(filePath, "utf8").replace(
    /^require\(['"]\/jscad-libs\/compat\/v1\.js['"]\);\s*/,
    ""
  );
  const exec = new Function("require", "window", "globalThis", code);
  exec(
    (path) => {
      if (path === "/jscad-libs/compat/v1.js") {
        return require("../public/jscad-libs/compat/v1.js");
      }
      return require(path);
    },
    globalThis.window,
    globalThis
  );
}

function loadCompatAndMechanics() {
  const v1 = require("../public/jscad-libs/compat/v1.js");
  globalThis.window = globalThis;
  evalLib(resolve(process.cwd(), "public/jscad-libs/mechanics/gears.jscad"));
  evalLib(resolve(process.cwd(), "public/jscad-libs/mechanics/racks.jscad"));
  return v1;
}

test("v1 compat exports coord and linkage helpers", () => {
  const v1 = require("../public/jscad-libs/compat/v1.js");
  expect(typeof v1.coord).toBe("function");
  expect(typeof v1.linkage).toBe("function");
});

test("coord helper supports 3-arg and 6-arg form", () => {
  const v1 = require("../public/jscad-libs/compat/v1.js");
  expect(v1.coord(0, -2, 0)).toEqual([0, -2, 0, 0, 0, 0]);
  expect(v1.coord(1, 2, 3, 4, 5, 6)).toEqual([1, 2, 3, 4, 5, 6]);
});

test("linkage returns prebuilt rack and pinion geometries", () => {
  const v1 = loadCompatAndMechanics();
  const assembly = v1.linkage(
    { initial: v1.coord(0, -2, 0), final: v1.coord(0, 2, 0) },
    { initial: v1.coord(10, 0, 0, 0, 0, 0), final: v1.coord(10, 0, 0, 0, 0, 50) }
  );

  expect(Array.isArray(assembly)).toBe(true);
  expect(assembly.length).toBe(2);
  expect(assembly[0]).toBeTruthy();
  expect(assembly[1]).toBeTruthy();
  expect(Array.isArray(assembly[0].polygons)).toBe(true);
  expect(Array.isArray(assembly[1].polygons)).toBe(true);
});

test("linkage works when rotation and translation motions are swapped", () => {
  const v1 = loadCompatAndMechanics();
  const assembly = v1.linkage(
    { initial: v1.coord(10, 0, 0, 0, 0, 0), final: v1.coord(10, 0, 0, 0, 0, 50) },
    { initial: v1.coord(0, -2, 0), final: v1.coord(0, 2, 0) }
  );

  expect(Array.isArray(assembly)).toBe(true);
  expect(assembly.length).toBe(2);
});

test("linkage rotates pinion phase to match rack position", () => {
  const v1 = loadCompatAndMechanics();

  const phaseA = v1.linkage(
    { initial: v1.coord(0, 0, 0), final: v1.coord(4, 0, 0) },
    { initial: v1.coord(10, 0, 0, 0, 0, 0), final: v1.coord(10, 0, 0, 0, 0, 50) }
  );
  const phaseB = v1.linkage(
    { initial: v1.coord(1, 0, 0), final: v1.coord(5, 0, 0) },
    { initial: v1.coord(10, 0, 0, 0, 0, 0), final: v1.coord(10, 0, 0, 0, 0, 50) }
  );

  expect(Array.isArray(phaseA[1].transforms)).toBe(true);
  expect(Array.isArray(phaseB[1].transforms)).toBe(true);
  expect(phaseA[1].transforms).not.toEqual(phaseB[1].transforms);
});
