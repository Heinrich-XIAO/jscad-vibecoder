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

function loadMechanicsLibraries() {
  require("../public/jscad-libs/compat/v1.js");
  globalThis.window = globalThis;
  evalLib(resolve(process.cwd(), "public/jscad-libs/mechanics/gears.jscad"));
  evalLib(resolve(process.cwd(), "public/jscad-libs/mechanics/racks.jscad"));
}

test("gear metadata exposes phase and pitch information", () => {
  loadMechanicsLibraries();

  const gear = globalThis.window.jscad.tspi.gear({}, 20, 8, 6, 1, 20);
  const pitch = gear.getPitchFeatures();
  const phase = gear.getPhaseMetadata();

  expect(pitch.type).toBe("pitch_circle");
  expect(pitch.pitchCircle.radius).toBe(10);
  expect(phase.initialToothPhaseOffsetDegrees).toBe(-4.5);
  expect(phase.recommendedRackShiftAtStartPitchFraction).toBe(0.25);
});

test("rack metadata exposes effective length and phase origin", () => {
  loadMechanicsLibraries();

  const rack = globalThis.window.jscad.tspi.rack({}, 100, 8, 1, 20, 20, 0, 2);
  const pitch = rack.getPitchFeatures();
  const phase = rack.getPhaseMetadata();

  expect(pitch.type).toBe("pitch_line");
  expect(pitch.pitchLine.normal).toEqual([0, 1, 0]);
  expect(phase.effectiveTeethNumber).toBeGreaterThan(0);
  expect(phase.effectiveLength).toBeGreaterThan(0);
  expect(Array.isArray(phase.phaseOrigin)).toBe(true);
});
