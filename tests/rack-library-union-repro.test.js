import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { expect, test } from "bun:test";

const require = createRequire(import.meta.url);

function loadRackLibrary() {
  require("../public/jscad-libs/compat/v1.js");
  globalThis.window = globalThis;

  const rackPath = resolve(
    process.cwd(),
    "public/jscad-libs/mechanics/racks.jscad"
  );
  const rackCode = readFileSync(rackPath, "utf8");
  const cleaned = rackCode.replace(
    /^require\(['"]\/jscad-libs\/compat\/v1\.js['"]\);\s*/,
    ""
  );

  const exec = new Function("require", "window", "globalThis", cleaned);
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

test("rack union repro: output includes full backing bar depth", () => {
  loadRackLibrary();

  const { measurements } = require("@jscad/modeling");
  const { measureBoundingBox } = measurements;

  const module = 2;
  const clearance = 0;
  const backHeight = 4;
  const thickness = 8;
  const teethNumber = 6;
  const pressureAngle = 20;

  const rack = globalThis.window.jscad.tspi.rack(
    {},
    0,
    thickness,
    module,
    teethNumber,
    pressureAngle,
    clearance,
    backHeight
  );

  const geometry = rack.getModel();
  const bbox = measureBoundingBox(geometry);
  const minY = bbox[0][1];

  expect(minY).toBeLessThan(-4);
});
