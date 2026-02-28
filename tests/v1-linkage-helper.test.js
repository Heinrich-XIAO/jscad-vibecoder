import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { expect, test } from "bun:test";

const require = createRequire(import.meta.url);
const { measurements } = require("@jscad/modeling");

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

let cachedCompat = null;

function loadCompatAndMechanics() {
  if (cachedCompat) return cachedCompat;
  const v1 = require("../public/jscad-libs/compat/v1.js");
  globalThis.window = globalThis;
  evalLib(resolve(process.cwd(), "public/jscad-libs/mechanics/gears.jscad"));
  evalLib(resolve(process.cwd(), "public/jscad-libs/mechanics/racks.jscad"));
  cachedCompat = v1;
  return cachedCompat;
}

function rotationZFromTransform(transform) {
  return (Math.atan2(-transform[4], transform[0]) * 180) / Math.PI;
}

function bbox(geometry) {
  return measurements.measureBoundingBox(geometry);
}

function widthX(geometry) {
  const bounds = bbox(geometry);
  return bounds[1][0] - bounds[0][0];
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

test("linkage keeps rack first and output gear last", () => {
  const v1 = loadCompatAndMechanics();
  const assembly = v1.linkage(
    { initial: v1.coord(0, 0, 0), final: v1.coord(Math.PI, 0, 0) },
    { initial: v1.coord(3 * Math.PI, 25, 0, 0, 0, 0), final: v1.coord(3 * Math.PI, 25, 0, 0, 0, 18) }
  );

  expect(Array.isArray(assembly)).toBe(true);
  expect(assembly.length).toBeGreaterThanOrEqual(2);
  expect(Array.isArray(assembly[0].polygons)).toBe(true);
  expect(Array.isArray(assembly[assembly.length - 1].polygons)).toBe(true);
});

test("linkage works when rotation and translation motions are swapped", () => {
  const v1 = loadCompatAndMechanics();
  const assembly = v1.linkage(
    { initial: v1.coord(10, 0, 0, 0, 0, 18), final: v1.coord(10, 0, 0, 0, 0, 36) },
    { initial: v1.coord(0, 0, 0), final: v1.coord(Math.PI, 0, 0) }
  );

  expect(Array.isArray(assembly)).toBe(true);
  expect(assembly.length).toBeGreaterThanOrEqual(2);
});

test("linkage preserves the rack endpoint pose exactly", () => {
  const v1 = loadCompatAndMechanics();
  const assembly = v1.linkage(
    { initial: v1.coord(5 * Math.PI, 20, 3), final: v1.coord(-5 * Math.PI, 20, 3) },
    { initial: v1.coord(3 * Math.PI, 0, 7, 0, 0, 0), final: v1.coord(3 * Math.PI, 0, 7, 0, 0, 180) }
  );

  expect(assembly[0].transforms[12]).toBeCloseTo(-5 * Math.PI, 10);
  expect(assembly[0].transforms[13]).toBeCloseTo(20, 10);
  expect(assembly[0].transforms[14]).toBeCloseTo(3, 10);
});

test("linkage preserves the output endpoint pose exactly", () => {
  const v1 = loadCompatAndMechanics();
  const assembly = v1.linkage(
    { initial: v1.coord(0, 0, 0), final: v1.coord(Math.PI, 0, 0) },
    { initial: v1.coord(3 * Math.PI, 25, 4, 0, 0, 0), final: v1.coord(3 * Math.PI, 25, 4, 0, 0, 18) }
  );
  const output = assembly[assembly.length - 1];

  expect(output.transforms[12]).toBeCloseTo(3 * Math.PI, 10);
  expect(output.transforms[13]).toBeCloseTo(25, 10);
  expect(output.transforms[14]).toBeCloseTo(4, 10);
});

test("linkage does not move the rack when only the gear y input changes", () => {
  const v1 = loadCompatAndMechanics();
  const base = v1.linkage(
    { initial: v1.coord(5 * Math.PI, 0, 0), final: v1.coord(-5 * Math.PI, 0, 0) },
    { initial: v1.coord(3 * Math.PI, 0, 0, 0, 0, 0), final: v1.coord(3 * Math.PI, 0, 0, 0, 0, 180) }
  );
  const shifted = v1.linkage(
    { initial: v1.coord(5 * Math.PI, 0, 0), final: v1.coord(-5 * Math.PI, 0, 0) },
    { initial: v1.coord(3 * Math.PI, 2, 0, 0, 0, 0), final: v1.coord(3 * Math.PI, 2, 0, 0, 0, 180) }
  );

  expect(shifted[0].transforms[13] - base[0].transforms[13]).toBeCloseTo(0, 10);
  expect(
    shifted[shifted.length - 1].transforms[13] - base[base.length - 1].transforms[13]
  ).toBeCloseTo(2, 10);
});

test("linkage does not move the output when only the rack y input changes", () => {
  const v1 = loadCompatAndMechanics();
  const base = v1.linkage(
    { initial: v1.coord(5 * Math.PI, 0, 0), final: v1.coord(-5 * Math.PI, 0, 0) },
    { initial: v1.coord(3 * Math.PI, 0, 0, 0, 0, 0), final: v1.coord(3 * Math.PI, 0, 0, 0, 0, 180) }
  );
  const shifted = v1.linkage(
    { initial: v1.coord(5 * Math.PI, 20, 0), final: v1.coord(-5 * Math.PI, 20, 0) },
    { initial: v1.coord(3 * Math.PI, 0, 0, 0, 0, 0), final: v1.coord(3 * Math.PI, 0, 0, 0, 0, 180) }
  );

  expect(shifted[0].transforms[13] - base[0].transforms[13]).toBeCloseTo(20, 10);
  expect(
    shifted[shifted.length - 1].transforms[13] - base[base.length - 1].transforms[13]
  ).toBeCloseTo(0, 10);
});

test("linkage treats output rotation as an authoritative endpoint pose", () => {
  const v1 = loadCompatAndMechanics();
  const base = v1.linkage(
    { initial: v1.coord(0, 0, 0), final: v1.coord(Math.PI, 0, 0) },
    { initial: v1.coord(3 * Math.PI, 10, 0, 0, 0, 0), final: v1.coord(3 * Math.PI, 10, 0, 0, 0, 18) }
  );
  const offset = v1.linkage(
    { initial: v1.coord(0, 0, 0), final: v1.coord(Math.PI, 0, 0) },
    { initial: v1.coord(3 * Math.PI, 10, 0, 0, 0, 120), final: v1.coord(3 * Math.PI, 10, 0, 0, 0, 138) }
  );

  expect(
    rotationZFromTransform(offset[offset.length - 1].transforms) -
      rotationZFromTransform(base[base.length - 1].transforms)
  ).toBeCloseTo(120, 10);
});

test("linkage interpolates rack translation and output rotation from progress", () => {
  const v1 = loadCompatAndMechanics();
  const start = v1.linkage(
    { initial: v1.coord(0, 0, 0), final: v1.coord(4, 0, 0) },
    { initial: v1.coord(10, 10, 0, 0, 0, 0), final: v1.coord(10, 10, 0, 0, 0, 50) },
    { progress: 0 }
  );
  const mid = v1.linkage(
    { initial: v1.coord(0, 0, 0), final: v1.coord(4, 0, 0) },
    { initial: v1.coord(10, 10, 0, 0, 0, 0), final: v1.coord(10, 10, 0, 0, 0, 50) },
    { progress: 0.5 }
  );
  const end = v1.linkage(
    { initial: v1.coord(0, 0, 0), final: v1.coord(4, 0, 0) },
    { initial: v1.coord(10, 10, 0, 0, 0, 0), final: v1.coord(10, 10, 0, 0, 0, 50) },
    { progress: 1 }
  );

  expect(start[0].transforms[12]).toBeCloseTo(0, 10);
  expect(mid[0].transforms[12]).toBeCloseTo(2, 10);
  expect(end[0].transforms[12]).toBeCloseTo(4, 10);
  expect(
    rotationZFromTransform(mid[mid.length - 1].transforms) -
      rotationZFromTransform(start[start.length - 1].transforms)
  ).toBeCloseTo(25, 10);
  expect(
    rotationZFromTransform(end[end.length - 1].transforms) -
      rotationZFromTransform(start[start.length - 1].transforms)
  ).toBeCloseTo(50, 10);
});

test("linkage uses a direct two-part mesh when fixed poses are directly meshable", () => {
  const v1 = loadCompatAndMechanics();
  const assembly = v1.linkage(
    { initial: v1.coord(0, 0, 0), final: v1.coord(Math.PI, 0, 0) },
    { initial: v1.coord(3 * Math.PI, -10, 0, 0, 0, 0), final: v1.coord(3 * Math.PI, -10, 0, 0, 0, -18) }
  );

  expect(assembly.length).toBe(2);
  expect(assembly[assembly.length - 1].transforms[13]).toBeCloseTo(-10, 10);
});

test("linkage reflects the rack when the gear is below it", () => {
  const v1 = loadCompatAndMechanics();
  const above = v1.linkage(
    { initial: v1.coord(0, 0, 0), final: v1.coord(Math.PI, 0, 0) },
    { initial: v1.coord(3 * Math.PI, 10, 0, 0, 0, 0), final: v1.coord(3 * Math.PI, 10, 0, 0, 0, 18) }
  );
  const below = v1.linkage(
    { initial: v1.coord(0, 0, 0), final: v1.coord(Math.PI, 0, 0) },
    { initial: v1.coord(3 * Math.PI, -10, 0, 0, 0, 0), final: v1.coord(3 * Math.PI, -10, 0, 0, 0, -18) }
  );
  const aboveBounds = bbox(above[0]);
  const belowBounds = bbox(below[0]);

  expect(aboveBounds[1][1]).toBeGreaterThan(0.9);
  expect(belowBounds[0][1]).toBeLessThan(-0.9);
});

test("linkage inserts the minimum train needed for a fixed output pose", () => {
  const v1 = loadCompatAndMechanics();
  const ratioMismatch = v1.linkage(
    { initial: v1.coord(0, -2, 0), final: v1.coord(0, 2, 0) },
    { initial: v1.coord(10, 0, 0, 0, 0, 0), final: v1.coord(10, 0, 0, 0, 0, 50) }
  );
  const reversalOnly = v1.linkage(
    { initial: v1.coord(10 * Math.PI, 0, 0), final: v1.coord(0, 0, 0) },
    { initial: v1.coord(3 * Math.PI, 0, 0, 0, 0, 0), final: v1.coord(3 * Math.PI, 0, 0, 0, 0, 180) }
  );
  const sameSignNeedsIdler = v1.linkage(
    { initial: v1.coord(0, 0, 0), final: v1.coord(Math.PI, 0, 0) },
    { initial: v1.coord(3 * Math.PI, 25, 0, 0, 0, 0), final: v1.coord(3 * Math.PI, 25, 0, 0, 0, 18) }
  );

  expect(ratioMismatch.length).toBe(3);
  expect(reversalOnly.length).toBe(3);
  expect(sameSignNeedsIdler.length).toBe(4);
  expect(sameSignNeedsIdler[sameSignNeedsIdler.length - 1].transforms[13]).toBeCloseTo(25, 10);
});

test("linkage can resize the fixed output gear while keeping it at the requested pose", () => {
  const v1 = loadCompatAndMechanics();
  const direct = v1.linkage(
    { initial: v1.coord(0, 0, 0), final: v1.coord(Math.PI, 0, 0) },
    { initial: v1.coord(3 * Math.PI, -10, 0, 0, 0, 0), final: v1.coord(3 * Math.PI, -10, 0, 0, 0, -18) }
  );
  const resized = v1.linkage(
    { initial: v1.coord(0, -2, 0), final: v1.coord(0, 2, 0) },
    { initial: v1.coord(10, 0, 0, 0, 0, 0), final: v1.coord(10, 0, 0, 0, 0, 50) }
  );

  expect(widthX(resized[resized.length - 1])).not.toBeCloseTo(widthX(direct[1]), 10);
  expect(resized[resized.length - 1].transforms[12]).toBeCloseTo(0, 10);
  expect(resized[resized.length - 1].transforms[13]).toBeCloseTo(0, 10);
});

test("linkage returns an explicit failure for unsupported zero-rotation input", () => {
  const v1 = loadCompatAndMechanics();
  const result = v1.linkage(
    { initial: v1.coord(0, 0, 0), final: v1.coord(4, 0, 0) },
    { initial: v1.coord(10, 10, 0, 0, 0, 0), final: v1.coord(10, 10, 0, 0, 0, 0) }
  );

  expect(result).toEqual(
    expect.objectContaining({
      success: false,
    })
  );
});
