import { createRequire } from "node:module";
import { expect, test } from "bun:test";

const require = createRequire(import.meta.url);

test("v1 compat exports coord and linkage helpers", () => {
  const v1 = require("../public/jscad-libs/compat/v1.js");
  expect(typeof v1.coord).toBe("function");
  expect(typeof v1.linkage).toBe("function");
});

test("coord helper supports 3-arg form", () => {
  const v1 = require("../public/jscad-libs/compat/v1.js");
  expect(v1.coord(0, -2, 0)).toEqual([0, -2, 0, 0, 0, 0]);
});

test("linkage infers rack-pinion radius from endpoint motions", () => {
  const v1 = require("../public/jscad-libs/compat/v1.js");
  const inferred = v1.linkage(
    { initial: v1.coord(0, -2, 0), final: v1.coord(0, 2, 0) },
    { initial: v1.coord(10, 0, 0, 0, 0, 0), final: v1.coord(10, 0, 0, 0, 0, 50) }
  );

  expect(inferred.translation.axis).toBe("y");
  expect(inferred.rotation.axis).toBe("rotZ");
  expect(inferred.translation.delta).toBe(4);
  expect(inferred.rotation.delta).toBe(50);
  expect(Math.abs(inferred.pitchRadius - 4.583662)).toBeLessThan(0.0001);
});

test("linkage also works when motions are passed in reverse order", () => {
  const v1 = require("../public/jscad-libs/compat/v1.js");
  const inferred = v1.linkage(
    { initial: v1.coord(10, 0, 0, 0, 0, 0), final: v1.coord(10, 0, 0, 0, 0, 50) },
    { initial: v1.coord(0, -2, 0), final: v1.coord(0, 2, 0) }
  );

  expect(inferred.classification.translationSource).toBe("motionB");
  expect(inferred.classification.rotationSource).toBe("motionA");
  expect(Math.abs(inferred.pitchRadius - 4.583662)).toBeLessThan(0.0001);
});
