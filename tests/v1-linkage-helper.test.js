import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { expect, test } from "bun:test";

const require = createRequire(import.meta.url);
const { booleans, measurements } = require("@jscad/modeling");

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
    { initial: v1.coord(0, 0, 0), final: v1.coord(4, 0, 0) },
    { initial: v1.coord(10, 0, 0, 0, 0, 0), final: v1.coord(10, 0, 0, 0, 0, 50) }
  );

  expect(Array.isArray(assembly)).toBe(true);
  expect(assembly.length).toBeGreaterThanOrEqual(2);
  expect(assembly[0]).toBeTruthy();
  expect(assembly[1]).toBeTruthy();
  expect(Array.isArray(assembly[0].polygons)).toBe(true);
  expect(Array.isArray(assembly[1].polygons)).toBe(true);
});

test("linkage works when rotation and translation motions are swapped", () => {
  const v1 = loadCompatAndMechanics();
  const assembly = v1.linkage(
    { initial: v1.coord(10, 0, 0, 0, 0, 0), final: v1.coord(10, 0, 0, 0, 0, 50) },
    { initial: v1.coord(0, 0, 0), final: v1.coord(4, 0, 0) }
  );

  expect(Array.isArray(assembly)).toBe(true);
  expect(assembly.length).toBeGreaterThanOrEqual(2);
});

test("linkage places the rack at its translated final pose", () => {
  const v1 = loadCompatAndMechanics();
  const assembly = v1.linkage(
    { initial: v1.coord(0, 0, 0), final: v1.coord(4, 0, 0) },
    { initial: v1.coord(10, 0, 0, 0, 0, 0), final: v1.coord(10, 0, 0, 0, 0, 50) }
  );

  expect(Array.isArray(assembly[0].transforms)).toBe(true);
  expect(assembly[0].transforms[12]).toBe(4);
  expect(assembly[0].transforms[13]).toBe(0);
});

test("linkage drives pinion rotation from rack travel for the stock demo geometry", () => {
  const v1 = loadCompatAndMechanics();
  const fromSmallRotation = v1.linkage(
    { initial: v1.coord(0, 0, 0), final: v1.coord(4, 0, 0) },
    { initial: v1.coord(10, 0, 0, 0, 0, 0), final: v1.coord(10, 0, 0, 0, 0, 20) }
  );
  const fromLargeRotation = v1.linkage(
    { initial: v1.coord(0, 0, 0), final: v1.coord(4, 0, 0) },
    { initial: v1.coord(10, 0, 0, 0, 0, 0), final: v1.coord(10, 0, 0, 0, 0, 50) }
  );

  expect(fromSmallRotation[1].transforms).toEqual(fromLargeRotation[1].transforms);
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

test("linkage treats rotation input as delta, not absolute angle", () => {
  const v1 = loadCompatAndMechanics();

  const base = v1.linkage(
    { initial: v1.coord(0, 0, 0), final: v1.coord(4, 0, 0) },
    { initial: v1.coord(10, 0, 0, 0, 0, 0), final: v1.coord(10, 0, 0, 0, 0, 50) }
  );
  const offsetAngles = v1.linkage(
    { initial: v1.coord(0, 0, 0), final: v1.coord(4, 0, 0) },
    { initial: v1.coord(10, 0, 0, 0, 0, 120), final: v1.coord(10, 0, 0, 0, 0, 170) }
  );

  expect(base[1].transforms).toEqual(offsetAngles[1].transforms);
});

test("linkage defaults omitted progress to the final pose", () => {
  const v1 = loadCompatAndMechanics();

  const implicitFinal = v1.linkage(
    { initial: v1.coord(0, 0, 0), final: v1.coord(4, 0, 0) },
    { initial: v1.coord(10, 0, 0, 0, 0, 0), final: v1.coord(10, 0, 0, 0, 0, 50) }
  );
  const explicitFinal = v1.linkage(
    { initial: v1.coord(0, 0, 0), final: v1.coord(4, 0, 0) },
    { initial: v1.coord(10, 0, 0, 0, 0, 0), final: v1.coord(10, 0, 0, 0, 0, 50) },
    { progress: 1 }
  );

  expect(implicitFinal[0].transforms).toEqual(explicitFinal[0].transforms);
  expect(implicitFinal[1].transforms).toEqual(explicitFinal[1].transforms);
});

test("linkage interpolates rack and pinion poses from progress", () => {
  const v1 = loadCompatAndMechanics();

  const start = v1.linkage(
    { initial: v1.coord(0, 0, 0), final: v1.coord(4, 0, 0) },
    { initial: v1.coord(10, 0, 0, 0, 0, 0), final: v1.coord(10, 0, 0, 0, 0, 50) },
    { progress: 0 }
  );
  const mid = v1.linkage(
    { initial: v1.coord(0, 0, 0), final: v1.coord(4, 0, 0) },
    { initial: v1.coord(10, 0, 0, 0, 0, 0), final: v1.coord(10, 0, 0, 0, 0, 50) },
    { progress: 0.5 }
  );
  const end = v1.linkage(
    { initial: v1.coord(0, 0, 0), final: v1.coord(4, 0, 0) },
    { initial: v1.coord(10, 0, 0, 0, 0, 0), final: v1.coord(10, 0, 0, 0, 0, 50) },
    { progress: 1 }
  );

  expect(start[0].transforms[12]).toBe(0);
  expect(mid[0].transforms[12]).toBe(2);
  expect(end[0].transforms[12]).toBe(4);
  expect(mid[1].transforms).not.toEqual(start[1].transforms);
  expect(mid[1].transforms).not.toEqual(end[1].transforms);
});

test("linkage stock demo advances by one tooth from the library-derived baseline phase", () => {
  const v1 = loadCompatAndMechanics();
  const gear = globalThis.window.jscad.tspi.gear({}, 20, 8, 6, 1, 20);
  const gearPhase = gear.getPhaseMetadata();
  const rack = globalThis.window.jscad.tspi.rack({}, 0, 8, 1, 20, 20, 0, 2);
  const rackPhase = rack.getPhaseMetadata();
  const pitchRadius = gear.getPitchFeatures().pitchCircle.radius;
  const baselinePhaseDeg =
    (rackPhase.referenceToothCenterAtStart / pitchRadius) * (180 / Math.PI) +
    gearPhase.initialToothPhaseOffsetDegrees;

  const start = v1.linkage(
    { initial: v1.coord(0, 0, 0), final: v1.coord(Math.PI, 0, 0) },
    { initial: v1.coord(3 * Math.PI, 0, 0, 0, 0, 0), final: v1.coord(3 * Math.PI, 0, 0, 0, 0, 18) },
    { progress: 0 }
  );
  const end = v1.linkage(
    { initial: v1.coord(0, 0, 0), final: v1.coord(Math.PI, 0, 0) },
    { initial: v1.coord(3 * Math.PI, 0, 0, 0, 0, 0), final: v1.coord(3 * Math.PI, 0, 0, 0, 0, 18) },
    { progress: 1 }
  );

  expect(rotationZFromTransform(start[1].transforms)).toBeCloseTo(baselinePhaseDeg, 10);
  expect(rotationZFromTransform(end[1].transforms) - rotationZFromTransform(start[1].transforms)).toBeCloseTo(18, 10);
});

test("linkage legacy y-translation demo keeps local tooth overlap below the old collision level", () => {
  const v1 = loadCompatAndMechanics();
  const { primitives } = require("@jscad/modeling");

  const assembly = v1.linkage(
    { initial: v1.coord(0, -2, 0), final: v1.coord(0, 2, 0) },
    { initial: v1.coord(10, 0, 0, 0, 0, 0), final: v1.coord(10, 0, 0, 0, 0, 50) }
  );

  const contactWindow = primitives.cuboid({ size: [8, 8, 20], center: [10, 1, 0] });
  const rackLocal = booleans.intersect(assembly[0], contactWindow);
  const gearLocal = booleans.intersect(assembly[1], contactWindow);
  const overlapVolume = measurements.measureVolume(booleans.intersect(rackLocal, gearLocal));

  expect(overlapVolume).toBeLessThan(260);
});

test("linkage adds an extra gear when the requested rotation ratio mismatches the stock pinion", () => {
  const v1 = loadCompatAndMechanics();

  const mismatched = v1.linkage(
    { initial: v1.coord(0, -2, 0), final: v1.coord(0, 2, 0) },
    { initial: v1.coord(10, 0, 0, 0, 0, 0), final: v1.coord(10, 0, 0, 0, 0, 50) }
  );
  const matched = v1.linkage(
    { initial: v1.coord(0, 0, 0), final: v1.coord(Math.PI, 0, 0) },
    { initial: v1.coord(3 * Math.PI, 0, 0, 0, 0, 0), final: v1.coord(3 * Math.PI, 0, 0, 0, 0, 18) }
  );

  expect(mismatched.length).toBe(3);
  expect(matched.length).toBe(2);
});
