/* eslint-disable @typescript-eslint/no-require-imports */
const modeling = require("@jscad/modeling");

const { primitives, booleans, transforms, extrusions, hulls, colors, geometries, measurements } =
  modeling;

const degToRad = (deg) => (deg * Math.PI) / 180;

const ensureArray = (value, length, fallback) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "number") {
    return Array.from({ length }, () => value);
  }
  return fallback;
};

const wrap = (geometry) => {
  if (!geometry || typeof geometry !== "object") return geometry;
  if (geometry.__v1Wrapped) return geometry;

  Object.defineProperty(geometry, "__v1Wrapped", { value: true });

  Object.assign(geometry, {
    translate(vec) {
      return wrap(transforms.translate(vec, this));
    },
    rotate(vec) {
      const radians = ensureArray(vec, 3, [0, 0, 0]).map(degToRad);
      return wrap(transforms.rotate(radians, this));
    },
    rotateX(angle) {
      return wrap(transforms.rotateX(degToRad(angle), this));
    },
    rotateY(angle) {
      return wrap(transforms.rotateY(degToRad(angle), this));
    },
    rotateZ(angle) {
      return wrap(transforms.rotateZ(degToRad(angle), this));
    },
    scale(value) {
      const scaleVec = ensureArray(value, 3, [1, 1, 1]);
      return wrap(transforms.scale(scaleVec, this));
    },
    mirroredX() {
      return wrap(transforms.mirror({ normal: [1, 0, 0] }, this));
    },
    mirroredY() {
      return wrap(transforms.mirror({ normal: [0, 1, 0] }, this));
    },
    mirroredZ() {
      return wrap(transforms.mirror({ normal: [0, 0, 1] }, this));
    },
    setColor(color) {
      return wrap(colors.colorize(color, this));
    },
    union(other) {
      return wrap(booleansCompat.union(this, other));
    },
    subtract(other) {
      return wrap(booleansCompat.subtract(this, other));
    },
    intersect(other) {
      return wrap(booleansCompat.intersect(this, other));
    },
    unionForNonIntersecting(other) {
      return wrap(booleansCompat.union(this, other));
    },
  });

  return geometry;
};

const cube = (options = {}) => {
  const size = ensureArray(options.size ?? 1, 3, [1, 1, 1]);
  const centered = options.center !== undefined ? options.center : true;
  const geom = primitives.cuboid({ size });
  if (centered) return wrap(geom);
  return wrap(transforms.translate([size[0] / 2, size[1] / 2, size[2] / 2], geom));
};

const sphere = (options = {}) => {
  const radius = options.r ?? options.radius ?? options.d / 2 ?? 1;
  const segments = options.fn ?? options.segments ?? 32;
  return wrap(primitives.sphere({ radius, segments }));
};

const cylinder = (options = {}) => {
  const height = options.h ?? options.height ?? 1;
  const center = options.center !== undefined ? options.center : true;
  const segments = options.fn ?? options.segments ?? 32;
  let radiusStart = options.r1 ?? options.d1 / 2 ?? options.r ?? options.d / 2;
  let radiusEnd = options.r2 ?? options.d2 / 2 ?? options.r ?? options.d / 2;

  // Ensure valid radius values (handle 0, undefined, NaN)
  if (!radiusStart || typeof radiusStart !== 'number' || isNaN(radiusStart)) radiusStart = 1;
  if (!radiusEnd || typeof radiusEnd !== 'number' || isNaN(radiusEnd)) radiusEnd = radiusStart;

  let geom;
  if (radiusStart === radiusEnd) {
    geom = primitives.cylinder({ height, radius: radiusStart, segments });
  } else {
    geom = primitives.cylinderElliptic({
      height,
      startRadius: [radiusStart, radiusStart],
      endRadius: [radiusEnd, radiusEnd],
      segments,
    });
  }

  if (center) return wrap(geom);
  return wrap(transforms.translate([0, 0, height / 2], geom));
};

const polygon = (points) => {
  if (Array.isArray(points) && points.length > 0 && points[0].points) {
    return wrap(primitives.polygon(points[0]));
  }
  return wrap(primitives.polygon({ points }));
};

const circle = (options = {}) => {
  const radius = options.r ?? options.radius ?? options.d / 2 ?? 1;
  const segments = options.fn ?? options.segments ?? 32;
  return wrap(primitives.circle({ radius, segments }));
};

const square = (options = {}) => {
  const size = ensureArray(options.size ?? 1, 2, [1, 1]);
  return wrap(primitives.rectangle({ size }));
};

const flatten = (items) =>
  items.flat ? items.flat() : [].concat(...items);

const normalizeBooleanArgs = (items) => flatten(items).filter(Boolean);

const EPSILON = 1e-6;

const toFiniteNumber = (value, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const normalizeCoord = (coord) => {
  if (Array.isArray(coord)) {
    const [x = 0, y = 0, z = 0, rotX = 0, rotY = 0, rotZ = 0] = coord;
    return {
      x: toFiniteNumber(x),
      y: toFiniteNumber(y),
      z: toFiniteNumber(z),
      rotX: toFiniteNumber(rotX),
      rotY: toFiniteNumber(rotY),
      rotZ: toFiniteNumber(rotZ),
    };
  }
  if (coord && typeof coord === "object") {
    return {
      x: toFiniteNumber(coord.x),
      y: toFiniteNumber(coord.y),
      z: toFiniteNumber(coord.z),
      rotX: toFiniteNumber(coord.rotX),
      rotY: toFiniteNumber(coord.rotY),
      rotZ: toFiniteNumber(coord.rotZ),
    };
  }
  return { x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0 };
};

const dominantAxis = (deltas) => {
  const entries = Object.entries(deltas)
    .map(([axis, delta]) => ({ axis, delta, abs: Math.abs(delta) }))
    .sort((a, b) => b.abs - a.abs);
  if (!entries.length || entries[0].abs <= EPSILON) {
    return { axis: entries[0]?.axis ?? "x", delta: 0, ambiguous: true };
  }
  const second = entries[1];
  const ambiguous = second ? second.abs >= entries[0].abs * 0.5 : false;
  return { axis: entries[0].axis, delta: entries[0].delta, ambiguous };
};

const coord = (x, y, z, rotX = 0, rotY = 0, rotZ = 0) => [x, y, z, rotX, rotY, rotZ];

const unwrapGeometry = (geometry) => {
  if (!geometry) return geometry;
  if (Array.isArray(geometry)) return geometry.map((item) => unwrapGeometry(item));
  if (typeof geometry === "object" && geometry.__v1Wrapped) {
    const clean = {};
    for (const key in geometry) {
      if (key !== "__v1Wrapped" && typeof geometry[key] !== "function") {
        clean[key] = geometry[key];
      }
    }
    return clean;
  }
  return geometry;
};

const defaultPrinterSettings = {
  scale: 1,
  correctionInsideDiameter: 0,
  correctionOutsideDiameter: 0,
  correctionInsideDiameterMoving: 0,
  correctionOutsideDiameterMoving: 0,
  resolutionCircle: 360,
};

const DEFAULT_RACK_PINION_GAP = 0;

const applyPose = (geometry, pose) => {
  const radians = [degToRad(pose.rotX), degToRad(pose.rotY), degToRad(pose.rotZ)];
  const rotated = transforms.rotate(radians, geometry);
  return transforms.translate([pose.x, pose.y, pose.z], rotated);
};

const getMechanicsApi = () => {
  const root = typeof globalThis !== "undefined" ? globalThis : {};
  const mechanics = root.window?.jscad?.tspi;
  if (!mechanics?.gear || !mechanics?.rack) {
    throw new Error(
      "linkage() requires /jscad-libs/mechanics/gears.jscad and /jscad-libs/mechanics/racks.jscad to be loaded."
    );
  }
  return mechanics;
};

const normalizePhaseOffset = (distance, period) => {
  if (!Number.isFinite(distance) || !Number.isFinite(period) || period <= EPSILON) return 0;
  let wrapped = distance % period;
  if (wrapped < 0) wrapped += period;
  if (wrapped > period / 2) wrapped -= period;
  return wrapped;
};

const linkage = (motionA, motionB) => {
  const probe = (motion) => ({
    initial: normalizeCoord(motion?.initial),
    final: normalizeCoord(motion?.final),
  });

  const a = probe(motionA);
  const b = probe(motionB);

  const deltasA = {
    linear: {
      x: a.final.x - a.initial.x,
      y: a.final.y - a.initial.y,
      z: a.final.z - a.initial.z,
    },
    angular: {
      rotX: a.final.rotX - a.initial.rotX,
      rotY: a.final.rotY - a.initial.rotY,
      rotZ: a.final.rotZ - a.initial.rotZ,
    },
  };
  const deltasB = {
    linear: {
      x: b.final.x - b.initial.x,
      y: b.final.y - b.initial.y,
      z: b.final.z - b.initial.z,
    },
    angular: {
      rotX: b.final.rotX - b.initial.rotX,
      rotY: b.final.rotY - b.initial.rotY,
      rotZ: b.final.rotZ - b.initial.rotZ,
    },
  };

  const linearA = dominantAxis(deltasA.linear);
  const linearB = dominantAxis(deltasB.linear);
  const angularA = dominantAxis(deltasA.angular);
  const angularB = dominantAxis(deltasB.angular);

  let translation = linearA;
  let rotation = angularB;
  let translationSource = "motionA";
  let rotationSource = "motionB";

  if (Math.abs(angularA.delta) > EPSILON && Math.abs(linearB.delta) > EPSILON) {
    translation = linearB;
    rotation = angularA;
    translationSource = "motionB";
    rotationSource = "motionA";
  }

  const mechanics = getMechanicsApi();
  const rackSource = translationSource === "motionA" ? a.initial : b.initial;
  const pinionSource = rotationSource === "motionA" ? a.initial : b.initial;

  const rackPart = mechanics.rack(defaultPrinterSettings);
  const pinionPart = mechanics.gear(defaultPrinterSettings);

  const rackModel = typeof rackPart?.getModel === "function" ? rackPart.getModel() : rackPart;
  const pinionModel = typeof pinionPart?.getModel === "function" ? pinionPart.getModel() : pinionPart;

  const pitchRadius =
    typeof pinionPart?.getPitchFeatures === "function"
      ? toFiniteNumber(pinionPart.getPitchFeatures()?.pitchCircle?.radius, 0)
      : 0;

  const rackPitch =
    typeof rackPart?.getPitchFeatures === "function"
      ? toFiniteNumber(rackPart.getPitchFeatures()?.circularPitch, 0)
      : 0;
  const gearPhase =
    typeof pinionPart?.getPhaseMetadata === "function" ? pinionPart.getPhaseMetadata() : null;
  const rackPhase =
    typeof rackPart?.getPhaseMetadata === "function" ? rackPart.getPhaseMetadata() : null;
  const recommendedRackShiftAtStart = toFiniteNumber(
    gearPhase?.recommendedRackShiftAtStart,
    0
  );
  const rackPhaseOriginX = toFiniteNumber(rackPhase?.phaseOrigin?.[0], 0);

  const alignedRackPose = {
    ...rackSource,
    y: 0,
  };
  const contactXInRackFrame = pinionSource.x - alignedRackPose.x - rackPhaseOriginX;
  const phaseResidualMm = normalizePhaseOffset(
    contactXInRackFrame - recommendedRackShiftAtStart,
    rackPitch
  );
  const alignmentRotationDeg =
    Math.abs(pitchRadius) > EPSILON ? -(phaseResidualMm / pitchRadius) * (180 / Math.PI) : 0;

  const alignedPinionPose = {
    ...pinionSource,
    y: alignedRackPose.y + pitchRadius + DEFAULT_RACK_PINION_GAP,
    rotZ: toFiniteNumber(pinionSource.rotZ, 0) + alignmentRotationDeg,
  };

  const positionedRack = applyPose(rackModel, alignedRackPose);
  const positionedPinion = applyPose(pinionModel, alignedPinionPose);

  return [unwrapGeometry(positionedRack), unwrapGeometry(positionedPinion)];
};

const getBoundingBox = (geometry) => {
  try {
    const bbox = measurements.measureBoundingBox(geometry);
    if (!bbox || !bbox[0] || !bbox[1]) return null;
    return bbox;
  } catch {
    return null;
  }
};

const isUnionLikeBounds = (candidate, inputs) => {
  const candidateBox = getBoundingBox(candidate);
  if (!candidateBox) return false;
  const inputBoxes = inputs.map(getBoundingBox);
  if (inputBoxes.some((box) => !box)) return false;

  for (let axis = 0; axis < 3; axis += 1) {
    const expectedMin = Math.min(...inputBoxes.map((box) => box[0][axis]));
    const expectedMax = Math.max(...inputBoxes.map((box) => box[1][axis]));
    if (candidateBox[0][axis] > expectedMin + EPSILON) return false;
    if (candidateBox[1][axis] < expectedMax - EPSILON) return false;
  }
  return true;
};

const isIntersectionLikeBounds = (candidate, inputs) => {
  const candidateBox = getBoundingBox(candidate);
  if (!candidateBox) return false;
  const inputBoxes = inputs.map(getBoundingBox);
  if (inputBoxes.some((box) => !box)) return false;

  for (let axis = 0; axis < 3; axis += 1) {
    const minAllowed = Math.max(...inputBoxes.map((box) => box[0][axis]));
    const maxAllowed = Math.min(...inputBoxes.map((box) => box[1][axis]));
    if (candidateBox[0][axis] < minAllowed - EPSILON) return false;
    if (candidateBox[1][axis] > maxAllowed + EPSILON) return false;
  }
  return true;
};

const safeUnionTwo = (left, right) => {
  const unionResult = booleans.union(left, right);
  if (isUnionLikeBounds(unionResult, [left, right])) return unionResult;

  const intersectResult = booleans.intersect(left, right);
  if (isUnionLikeBounds(intersectResult, [left, right])) return intersectResult;

  return unionResult;
};

const safeIntersectTwo = (left, right) => {
  const intersectResult = booleans.intersect(left, right);
  if (isIntersectionLikeBounds(intersectResult, [left, right])) return intersectResult;

  const unionResult = booleans.union(left, right);
  if (isIntersectionLikeBounds(unionResult, [left, right])) return unionResult;

  return intersectResult;
};

const safeUnion = (...inputGeometries) => {
  const normalized = normalizeBooleanArgs(inputGeometries);
  if (normalized.length === 0) return geometries.geom3.create();
  if (normalized.length === 1) return normalized[0];
  return normalized.slice(1).reduce((acc, geometry) => safeUnionTwo(acc, geometry), normalized[0]);
};

const safeIntersect = (...inputGeometries) => {
  const normalized = normalizeBooleanArgs(inputGeometries);
  if (normalized.length === 0) return geometries.geom3.create();
  if (normalized.length === 1) return normalized[0];
  return normalized.slice(1).reduce((acc, geometry) => safeIntersectTwo(acc, geometry), normalized[0]);
};

const booleansCompat = {
  ...booleans,
  union: (...geometries) => safeUnion(...geometries),
  subtract: (base, ...cuts) => booleans.subtract(base, ...normalizeBooleanArgs(cuts)),
  intersect: (...geometries) => safeIntersect(...geometries),
};

const union = (...geometries) => wrap(booleansCompat.union(...geometries));
const difference = (base, ...cuts) =>
  wrap(booleansCompat.subtract(base, ...cuts));
const intersection = (...geometries) =>
  wrap(booleansCompat.intersect(...geometries));

const linear_extrude = (options = {}, geometry) => {
  const height = options.height ?? options.h ?? 1;
  return wrap(extrusions.extrudeLinear({ height }, geometry));
};

const rotate_extrude = (options = {}, geometry) => {
  const angle = options.angle ?? options.a ?? 360;
  const segments = options.fn ?? options.segments ?? 32;
  return wrap(
    extrusions.extrudeRotate({ angle: degToRad(angle), segments }, geometry)
  );
};

const hull = (...geometries) => wrap(hulls.hull(...geometries));
const translate = (vec, geometry) => wrap(transforms.translate(vec, geometry));
const rotate = (vec, geometry) => {
  const radians = ensureArray(vec, 3, [0, 0, 0]).map(degToRad);
  return wrap(transforms.rotate(radians, geometry));
};
const scale = (value, geometry) => {
  const scaleVec = ensureArray(value, 3, [1, 1, 1]);
  return wrap(transforms.scale(scaleVec, geometry));
};
const color = (value, geometry) => wrap(colors.colorize(value, geometry));

class Vector2D {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  static fromAngle(angle) {
    return new Vector2D(Math.cos(angle), Math.sin(angle));
  }

  normal() {
    return new Vector2D(-this.y, this.x);
  }

  times(value) {
    return new Vector2D(this.x * value, this.y * value);
  }

  plus(other) {
    return new Vector2D(this.x + other.x, this.y + other.y);
  }

  negated() {
    return new Vector2D(-this.x, -this.y);
  }
}

class Polygon2D {
  constructor(points, closed) {
    this.points = points || [];
    this.closed = closed !== false;
  }

  toGeom2() {
    const pts = this.points.map((p) => (Array.isArray(p) ? p : [p.x, p.y]));
    return primitives.polygon({ points: pts });
  }

  extrude(options = {}) {
    const height = options.height ?? options.h ?? (options.offset?.[2] ?? 1);
    if (options.twistangle) {
      const angle = degToRad(options.twistangle);
      const segmentsPerRotation = Math.max(3, options.twiststeps ?? 32);
      return wrap(
        extrusions.extrudeHelical(
          { angle, height, segmentsPerRotation },
          this.toGeom2()
        )
      );
    }
    return wrap(extrusions.extrudeLinear({ height }, this.toGeom2()));
  }

  rotateExtrude(options = {}) {
    const angle = options.angle ?? options.a ?? 360;
    const segments = options.fn ?? options.segments ?? 32;
    return wrap(
      extrusions.extrudeRotate({ angle: degToRad(angle), segments }, this.toGeom2())
    );
  }
}

const CAG = {
  fromPoints(points) {
    return wrap(primitives.polygon({ points }));
  },
};

function CSG() {
  return wrap(geometries.geom3.create());
}

CSG.Vector2D = Vector2D;
CSG.Polygon2D = Polygon2D;

const api = {
  CSG,
  CAG,
  cube,
  cylinder,
  sphere,
  circle,
  square,
  polygon,
  union,
  difference,
  intersection,
  hull,
  linear_extrude,
  rotate_extrude,
  translate,
  rotate,
  scale,
  color,
  booleans: booleansCompat,
  coord,
  linkage,
};

// Helper to unwrap geometries before serialization (removes wrapper methods)
api.unwrap = unwrapGeometry;

const target = typeof globalThis !== "undefined" ? globalThis : {};
Object.assign(target, api);

module.exports = api;
