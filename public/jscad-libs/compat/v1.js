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

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

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

const interpolateCoord = (initial, final, progress) => ({
  x: initial.x + (final.x - initial.x) * progress,
  y: initial.y + (final.y - initial.y) * progress,
  z: initial.z + (final.z - initial.z) * progress,
  rotX: initial.rotX + (final.rotX - initial.rotX) * progress,
  rotY: initial.rotY + (final.rotY - initial.rotY) * progress,
  rotZ: initial.rotZ + (final.rotZ - initial.rotZ) * progress,
});

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

const liftPhaseEquivalentAngle = (phaseAngleDeg, preferredAngleDeg, periodDeg) => {
  if (
    !Number.isFinite(phaseAngleDeg) ||
    !Number.isFinite(preferredAngleDeg) ||
    !Number.isFinite(periodDeg) ||
    Math.abs(periodDeg) <= EPSILON
  ) {
    return phaseAngleDeg;
  }
  return phaseAngleDeg + Math.round((preferredAngleDeg - phaseAngleDeg) / periodDeg) * periodDeg;
};

const liftPhaseEquivalentAngleWithTieBreak = (phaseAngleDeg, preferredAngleDeg, periodDeg) => {
  if (
    !Number.isFinite(phaseAngleDeg) ||
    !Number.isFinite(preferredAngleDeg) ||
    !Number.isFinite(periodDeg) ||
    Math.abs(periodDeg) <= EPSILON
  ) {
    return phaseAngleDeg;
  }
  const base = (preferredAngleDeg - phaseAngleDeg) / periodDeg;
  const lower = phaseAngleDeg + Math.floor(base) * periodDeg;
  const upper = phaseAngleDeg + Math.ceil(base) * periodDeg;
  const lowerDistance = Math.abs(lower - preferredAngleDeg);
  const upperDistance = Math.abs(upper - preferredAngleDeg);
  if (Math.abs(lowerDistance - upperDistance) <= EPSILON) {
    return preferredAngleDeg >= 0 ? Math.max(lower, upper) : Math.min(lower, upper);
  }
  return lowerDistance < upperDistance ? lower : upper;
};

const buildGearPart = (
  mechanics,
  printerSettings,
  pitchDiameter,
  teethNumber,
  pressureAngle,
  thickness = 8,
  boreDiameter = 6
) => {
  if (typeof mechanics?.involuteGearByPitchDiameterTeeth === "function") {
    return mechanics.involuteGearByPitchDiameterTeeth(
      printerSettings,
      pitchDiameter,
      teethNumber,
      pressureAngle,
      thickness,
      boreDiameter / 2
    );
  }
  return mechanics.gear(
    printerSettings,
    pitchDiameter,
    thickness,
    boreDiameter,
    pitchDiameter / Math.max(teethNumber, 1),
    pressureAngle
  );
};

const getPartModel = (part) => (typeof part?.getModel === "function" ? part.getModel() : part);

const getPitchFeatures = (part) =>
  typeof part?.getPitchFeatures === "function" ? part.getPitchFeatures() : null;

const getPhaseMetadata = (part) =>
  typeof part?.getPhaseMetadata === "function" ? part.getPhaseMetadata() : null;

const findBestAngleByOverlap = ({
  buildMovingGeometry,
  fixedGeometry,
  contactWindow,
  startDeg,
  endDeg,
  preferredAngleDeg = 0,
  coarseSamples = 24,
  refineRounds = 2,
}) => {
  let bestAngleDeg = startDeg;
  let bestOverlap = Number.POSITIVE_INFINITY;

  let currentStart = startDeg;
  let currentEnd = endDeg;
  for (let round = 0; round < refineRounds; round += 1) {
    const samples = round === 0 ? coarseSamples : Math.max(12, Math.floor(coarseSamples / 2));
    const step = (currentEnd - currentStart) / samples;
    for (let i = 0; i <= samples; i += 1) {
      const angleDeg = currentStart + step * i;
      const movingGeometry = buildMovingGeometry(angleDeg);
      const fixedLocal = booleans.intersect(fixedGeometry, contactWindow);
      const movingLocal = booleans.intersect(movingGeometry, contactWindow);
      const overlap = measurements.measureVolume(booleans.intersect(fixedLocal, movingLocal));
      const overlapImproved = overlap < bestOverlap - EPSILON;
      const overlapTied = Math.abs(overlap - bestOverlap) <= EPSILON;
      const currentDistance = Math.abs(angleDeg - preferredAngleDeg);
      const bestDistance = Math.abs(bestAngleDeg - preferredAngleDeg);
      const closerToPreferred = currentDistance < bestDistance - EPSILON;
      const sameDistance = Math.abs(currentDistance - bestDistance) <= EPSILON;
      const preferPositive = preferredAngleDeg >= 0 ? angleDeg > bestAngleDeg : angleDeg < bestAngleDeg;
      if (
        overlapImproved ||
        (overlapTied && (closerToPreferred || (sameDistance && preferPositive)))
      ) {
        bestOverlap = overlap;
        bestAngleDeg = angleDeg;
      }
    }
    currentStart = bestAngleDeg - step;
    currentEnd = bestAngleDeg + step;
  }

  return bestAngleDeg;
};

const computeRackMeshedRotation = ({
  gearPart,
  centerX,
  rackX,
  rackPhaseOriginX,
  preferredAngleDeg,
  rackFacingSign = 1,
}) => {
  const gearPitch = getPitchFeatures(gearPart);
  const pitchRadius = toFiniteNumber(gearPitch?.pitchCircle?.radius, 0);
  const teethNumber = Math.max(1, Math.round(toFiniteNumber(gearPitch?.teethNumber, 20)));
  if (Math.abs(pitchRadius) <= EPSILON) return preferredAngleDeg;

  const contactXInRackFrame = centerX - rackX - rackPhaseOriginX;
  const visiblePhaseTargetDeg =
    (-(contactXInRackFrame / pitchRadius) * (180 / Math.PI)) / (rackFacingSign || 1);
  const theoreticalAngleDeg = liftPhaseEquivalentAngleWithTieBreak(
    visiblePhaseTargetDeg,
    preferredAngleDeg,
    360 / teethNumber
  );
  return theoreticalAngleDeg;
};

const classifyLinkageEndpoints = (motionA, motionB, currentA, currentB) => {
  const deltasA = {
    linear: {
      x: motionA.final.x - motionA.initial.x,
      y: motionA.final.y - motionA.initial.y,
      z: motionA.final.z - motionA.initial.z,
    },
    angular: {
      rotX: motionA.final.rotX - motionA.initial.rotX,
      rotY: motionA.final.rotY - motionA.initial.rotY,
      rotZ: motionA.final.rotZ - motionA.initial.rotZ,
    },
  };
  const deltasB = {
    linear: {
      x: motionB.final.x - motionB.initial.x,
      y: motionB.final.y - motionB.initial.y,
      z: motionB.final.z - motionB.initial.z,
    },
    angular: {
      rotX: motionB.final.rotX - motionB.initial.rotX,
      rotY: motionB.final.rotY - motionB.initial.rotY,
      rotZ: motionB.final.rotZ - motionB.initial.rotZ,
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

  const rackMotion = translationSource === "motionA" ? motionA : motionB;
  const outputMotion = rotationSource === "motionA" ? motionA : motionB;

  return {
    deltasA,
    deltasB,
    linearA,
    linearB,
    angularA,
    angularB,
    translation,
    rotation,
    translationSource,
    rotationSource,
    rackSource: translationSource === "motionA" ? currentA : currentB,
    outputSource: rotationSource === "motionA" ? currentA : currentB,
    rackInitial: rackMotion.initial,
    outputInitial: outputMotion.initial,
  };
};

const buildRackEndpointPose = (rackSource) => ({
  x: rackSource.x,
  y: rackSource.y,
  z: rackSource.z,
  rotX: rackSource.rotX,
  rotY: rackSource.rotY,
  rotZ: rackSource.rotZ,
});

const buildOutputEndpointPose = (outputSource) => ({
  x: outputSource.x,
  y: outputSource.y,
  z: outputSource.z,
  rotX: outputSource.rotX,
  rotY: outputSource.rotY,
  rotZ: outputSource.rotZ,
});

const getRackModelWithFacing = (rackModel, rackFacingSign) =>
  rackFacingSign >= 0 ? rackModel : transforms.mirror({ normal: [0, 1, 0] }, rackModel);

const buildGearPartFromRadius = (
  mechanics,
  pitchRadius,
  module,
  pressureAngle,
  thickness = 8,
  boreDiameter = 6
) => {
  const safeRadius = Math.max(pitchRadius, module * 3, EPSILON);
  const teethNumber = Math.max(6, Math.round((2 * safeRadius) / Math.max(module, EPSILON)));
  return buildGearPart(
    mechanics,
    defaultPrinterSettings,
    safeRadius * 2,
    teethNumber,
    pressureAngle,
    thickness,
    boreDiameter
  );
};

const solveGearCenters2D = ({ start, end, startRadius, endRadius, insertedIdlers, idlerRadius }) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distanceMin = Math.abs(dy);
  if (insertedIdlers === 0) {
    const targetDistance = startRadius + endRadius;
    if (distanceMin > targetDistance + EPSILON) return null;
    const xOffset = Math.sqrt(Math.max(targetDistance * targetDistance - dy * dy, 0));
    const startX = end.x - xOffset;
    return {
      start: { x: startX, y: start.y },
      idlers: [],
      distance: targetDistance,
    };
  }

  const targetDistance = startRadius + endRadius + 2 * idlerRadius;
  if (distanceMin > targetDistance + EPSILON) return null;
  const xOffset = Math.sqrt(Math.max(targetDistance * targetDistance - dy * dy, 0));
  const startX = end.x - xOffset;
  const normalizedDx = end.x - startX;
  const normalizedDy = dy;
  const segmentLength = Math.sqrt(normalizedDx * normalizedDx + normalizedDy * normalizedDy);
  const firstHop = startRadius + idlerRadius;
  const fraction = segmentLength > EPSILON ? firstHop / segmentLength : 0;
  return {
    start: { x: startX, y: start.y },
    idlers: [
      {
        x: startX + normalizedDx * fraction,
        y: start.y + normalizedDy * fraction,
      },
    ],
    distance: targetDistance,
  };
};

const solveDirectRackOutputMesh = ({
  mechanics,
  rackPose,
  outputPose,
  rackFacingSign,
  totalRackTravel,
  totalOutputRotationDeg,
  pinionModule,
  pinionPressureAngle,
}) => {
  if (Math.abs(totalRackTravel) <= EPSILON || Math.abs(totalOutputRotationDeg) <= EPSILON) return null;
  const geometryRadius = Math.abs(outputPose.y - rackPose.y) - DEFAULT_RACK_PINION_GAP;
  if (geometryRadius <= EPSILON) return null;
  const kinematicRadius = Math.abs(totalRackTravel / degToRad(totalOutputRotationDeg));
  if (Math.abs(geometryRadius - kinematicRadius) > 0.75) return null;

  const rackDrivenRotationSign = (Math.sign(totalRackTravel) || 1) * rackFacingSign;
  const requestedRotationSign = Math.sign(totalOutputRotationDeg) || 1;
  if (rackDrivenRotationSign !== requestedRotationSign) return null;

  const outputPart = buildGearPartFromRadius(
    mechanics,
    geometryRadius,
    pinionModule,
    pinionPressureAngle
  );
  return { outputPart, outputRadius: geometryRadius };
};

const solveGearTrainBetweenFixedEndpoints = ({
  mechanics,
  rackPose,
  rackInitial,
  rackFacingSign,
  rackModel,
  rackPhaseOriginX,
  outputPose,
  outputInitial,
  outputModel,
  pinionModule,
  pinionPressureAngle,
  stockPitchRadius,
  totalRackTravel,
  totalOutputRotationDeg,
  currentRackTravel,
}) => {
  if (Math.abs(totalRackTravel) <= EPSILON || Math.abs(totalOutputRotationDeg) <= EPSILON) {
    return {
      error: {
        success: false,
        error: "Unable to solve gear train from fixed endpoint poses.",
      },
    };
  }

  const outputRadius = Math.max(
    Math.abs(totalRackTravel / degToRad(totalOutputRotationDeg)),
    pinionModule * 3
  );
  const outputPart = buildGearPartFromRadius(
    mechanics,
    outputRadius,
    pinionModule,
    pinionPressureAngle
  );
  const driverRotationSign = (Math.sign(totalRackTravel) || 1) * rackFacingSign;
  const requestedRotationSign = Math.sign(totalOutputRotationDeg) || 1;
  const insertedIdlers = driverRotationSign === requestedRotationSign ? 1 : 0;

  let driverRadius = Math.max(stockPitchRadius, pinionModule * 3);
  const verticalGap = Math.abs(outputPose.y - (rackPose.y + rackFacingSign * driverRadius));
  if (insertedIdlers === 0) {
    driverRadius = Math.max(driverRadius, verticalGap - outputRadius + pinionModule);
  }

  const driverPart = buildGearPartFromRadius(
    mechanics,
    driverRadius,
    pinionModule,
    pinionPressureAngle
  );
  const driverPitch = getPitchFeatures(driverPart);
  driverRadius = toFiniteNumber(driverPitch?.pitchCircle?.radius, driverRadius);
  const driverPoseBase = {
    x: rackPose.x,
    y: rackPose.y + rackFacingSign * (driverRadius + DEFAULT_RACK_PINION_GAP),
  };

  let idlerRadius = Math.max(Math.min(driverRadius, outputRadius), pinionModule * 3);
  if (insertedIdlers === 1) {
    const minDistance = Math.abs(outputPose.y - driverPoseBase.y);
    idlerRadius = Math.max(idlerRadius, (minDistance - driverRadius - outputRadius) / 2 + pinionModule);
  }

  const centers = solveGearCenters2D({
    start: driverPoseBase,
    end: { x: outputPose.x, y: outputPose.y },
    startRadius: driverRadius,
    endRadius: outputRadius,
    insertedIdlers,
    idlerRadius,
  });
  if (!centers) {
    return {
      error: {
        success: false,
        error: "Unable to solve gear-center layout for fixed endpoint poses.",
      },
    };
  }

  const driverPose = {
    x: centers.start.x,
    y: centers.start.y,
    z: outputPose.z,
    rotX: 0,
    rotY: 0,
    rotZ: 0,
  };
  const driverStartAngleDeg = computeRackMeshedRotation({
    gearPart: driverPart,
    centerX: driverPose.x,
    rackX: rackInitial.x,
    rackPhaseOriginX,
    preferredAngleDeg: rackFacingSign * EPSILON,
    rackFacingSign,
  });
  const driverDeltaDeg =
    (Math.abs(currentRackTravel) / Math.max(driverRadius, EPSILON)) *
    (180 / Math.PI) *
    driverRotationSign;
  driverPose.rotZ = driverStartAngleDeg + driverDeltaDeg;

  const assembly = [
    {
      part: driverPart,
      model: getPartModel(driverPart),
      pose: driverPose,
    },
  ];

  if (insertedIdlers === 1) {
    const idlerPart = buildGearPartFromRadius(
      mechanics,
      idlerRadius,
      pinionModule,
      pinionPressureAngle
    );
    assembly.push({
      part: idlerPart,
      model: getPartModel(idlerPart),
      pose: {
        x: centers.idlers[0].x,
        y: centers.idlers[0].y,
        z: outputPose.z,
        rotX: 0,
        rotY: 0,
        rotZ: 0,
      },
    });
  }

  const outputNode = {
    part: outputPart,
    model: outputModel ?? getPartModel(outputPart),
    pose: {
      ...outputPose,
      rotX: outputPose.rotX,
      rotY: outputPose.rotY,
      rotZ: outputPose.rotZ,
    },
  };

  let preferredDriverAngleDeg = outputNode.pose.rotZ;
  let backwardDriverNode = outputNode;
  for (let index = assembly.length - 1; index >= 0; index -= 1) {
    const followerNode = assembly[index];
    preferredDriverAngleDeg = computeMeshedFollowerAngle({
      driverAngleDeg: backwardDriverNode.pose.rotZ,
      driverPart: backwardDriverNode.part,
      driverModel: backwardDriverNode.model,
      driverCenterX: backwardDriverNode.pose.x,
      driverCenterY: backwardDriverNode.pose.y,
      followerPart: followerNode.part,
      followerModel: followerNode.model,
      followerCenterX: followerNode.pose.x,
      followerCenterY: followerNode.pose.y,
    });
    backwardDriverNode = {
      ...followerNode,
      pose: {
        ...followerNode.pose,
        rotZ: preferredDriverAngleDeg,
      },
    };
  }

  driverPose.rotZ = computeRackMeshedRotation({
    gearPart: driverPart,
    centerX: driverPose.x,
    rackX: rackInitial.x,
    rackPhaseOriginX,
    preferredAngleDeg: preferredDriverAngleDeg,
    rackFacingSign,
  });
  driverPose.rotZ += driverDeltaDeg;

  if (assembly.length === 2) {
    assembly[1].pose.rotZ = computeMeshedFollowerAngle({
      driverAngleDeg: assembly[0].pose.rotZ,
      driverPart: assembly[0].part,
      driverModel: assembly[0].model,
      driverCenterX: assembly[0].pose.x,
      driverCenterY: assembly[0].pose.y,
      followerPart: assembly[1].part,
      followerModel: assembly[1].model,
      followerCenterX: assembly[1].pose.x,
      followerCenterY: assembly[1].pose.y,
    });
  }

  assembly.push(outputNode);
  if (assembly.length === 3) {
    assembly[1].pose.rotZ = computeMeshedFollowerAngle({
      driverAngleDeg: assembly[2].pose.rotZ,
      driverPart: assembly[2].part,
      driverModel: assembly[2].model,
      driverCenterX: assembly[2].pose.x,
      driverCenterY: assembly[2].pose.y,
      followerPart: assembly[1].part,
      followerModel: assembly[1].model,
      followerCenterX: assembly[1].pose.x,
      followerCenterY: assembly[1].pose.y,
    });
  } else {
    for (let index = 1; index < assembly.length - 1; index += 1) {
      const previousNode = assembly[index - 1];
      const currentNode = assembly[index];
      currentNode.pose.rotZ = computeMeshedFollowerAngle({
        driverAngleDeg: previousNode.pose.rotZ,
        driverPart: previousNode.part,
        driverModel: previousNode.model,
        driverCenterX: previousNode.pose.x,
        driverCenterY: previousNode.pose.y,
        followerPart: currentNode.part,
        followerModel: currentNode.model,
        followerCenterX: currentNode.pose.x,
        followerCenterY: currentNode.pose.y,
      });
    }
  }

  return {
    rackDriver: assembly[0],
    idlers: assembly.slice(1, -1),
    output: assembly[assembly.length - 1],
  };
};

const computeMeshedFollowerAngle = ({
  driverAngleDeg,
  driverPart,
  driverModel,
  driverCenterX,
  driverCenterY,
  followerPart,
  followerModel,
  followerCenterX,
  followerCenterY,
}) => {
  const driverPitch = getPitchFeatures(driverPart);
  const followerPitch = getPitchFeatures(followerPart);
  const driverTeeth = Math.max(1, Math.round(toFiniteNumber(driverPitch?.teethNumber, 20)));
  const followerTeeth = Math.max(1, Math.round(toFiniteNumber(followerPitch?.teethNumber, 20)));
  const driverPhase = toFiniteNumber(getPhaseMetadata(driverPart)?.initialToothPhaseOffsetDegrees, 0);
  const followerPhase = toFiniteNumber(
    getPhaseMetadata(followerPart)?.initialToothPhaseOffsetDegrees,
    0
  );
  const theoreticalAngleDeg =
    followerPhase - ((driverAngleDeg - driverPhase) * driverTeeth) / followerTeeth;
  const periodDeg = 360 / followerTeeth;
  const contactWindow = primitives.cuboid({
    size: [
      Math.max(toFiniteNumber(followerPitch?.circularPitch, Math.PI) * 2, 5),
      Math.max(Math.min(toFiniteNumber(followerPitch?.pitchCircle?.radius, 0) * 1.4, 12), 6),
      20,
    ],
    center: [(driverCenterX + followerCenterX) / 2, (driverCenterY + followerCenterY) / 2, 0],
  });
  const positionedDriver = applyPose(driverModel, {
    x: driverCenterX,
    y: driverCenterY,
    z: 0,
    rotX: 0,
    rotY: 0,
    rotZ: driverAngleDeg,
  });
  const searchStart = theoreticalAngleDeg - periodDeg / 2;
  const searchEnd = theoreticalAngleDeg + periodDeg / 2;
  return findBestAngleByOverlap({
    fixedGeometry: positionedDriver,
    contactWindow,
    startDeg: searchStart,
    endDeg: searchEnd,
    buildMovingGeometry: (angleDeg) =>
      applyPose(followerModel, {
        x: followerCenterX,
        y: followerCenterY,
        z: 0,
        rotX: 0,
        rotY: 0,
        rotZ: angleDeg,
      }),
  });
};

const linkage = (motionA, motionB, options = {}) => {
  const probe = (motion) => ({
    initial: normalizeCoord(motion?.initial),
    final: normalizeCoord(motion?.final),
  });

  const progressInput =
    typeof options === "number"
      ? options
      : typeof options?.progress === "number"
        ? options.progress
        : 1;
  const progress = clamp(progressInput, 0, 1);

  const a = probe(motionA);
  const b = probe(motionB);
  const currentA = interpolateCoord(a.initial, a.final, progress);
  const currentB = interpolateCoord(b.initial, b.final, progress);
  const classification = classifyLinkageEndpoints(a, b, currentA, currentB);
  const { translation, rotation, rackSource, outputSource, rackInitial, outputInitial } = classification;

  const mechanics = getMechanicsApi();
  if (Math.abs(translation.delta) <= EPSILON || Math.abs(rotation.delta) <= EPSILON) {
    return {
      success: false,
      error: "linkage requires one dominant translational motion and one dominant rotational motion.",
    };
  }

  const rackPart = mechanics.rack(defaultPrinterSettings);
  const stockPinionPart = mechanics.gear(defaultPrinterSettings);
  const rackFacingSign = outputSource.y >= rackSource.y ? 1 : -1;
  const rackPose = buildRackEndpointPose(rackSource);
  const outputPose = buildOutputEndpointPose(outputSource);
  const rackModel = getRackModelWithFacing(getPartModel(rackPart), rackFacingSign);

  const pinionPitch = getPitchFeatures(stockPinionPart);
  const stockPitchRadius = toFiniteNumber(pinionPitch?.pitchCircle?.radius, 0);
  const pinionModule = toFiniteNumber(pinionPitch?.module, 1);
  const pinionPressureAngle = toFiniteNumber(pinionPitch?.pressureAngle, 20);

  const rackPhase = getPhaseMetadata(rackPart);
  const rackPhaseOriginX = toFiniteNumber(rackPhase?.phaseOrigin?.[0], 0);
  const positionedRack = applyPose(rackModel, rackPose);
  const assembly = [unwrapGeometry(positionedRack)];
  const totalRackTravel = translation.delta;
  const totalOutputRotationDeg = rotation.delta;
  const currentRackTravel = rackSource[translation.axis] - rackInitial[translation.axis];

  const direct = solveDirectRackOutputMesh({
    mechanics,
    rackPose,
    outputPose,
    rackFacingSign,
    totalRackTravel,
    totalOutputRotationDeg,
    pinionModule,
    pinionPressureAngle,
  });
  if (direct) {
    assembly.push(unwrapGeometry(applyPose(getPartModel(direct.outputPart), outputPose)));
    return assembly;
  }

  const train = solveGearTrainBetweenFixedEndpoints({
    mechanics,
    rackPose,
    rackInitial,
    rackFacingSign,
    rackModel,
    rackPhaseOriginX,
    outputPose,
    outputInitial,
    pinionModule,
    pinionPressureAngle,
    stockPitchRadius,
    totalRackTravel,
    totalOutputRotationDeg,
    currentRackTravel,
  });
  if (train.error) return train.error;

  assembly.push(unwrapGeometry(applyPose(train.rackDriver.model, train.rackDriver.pose)));
  for (const idler of train.idlers) {
    assembly.push(unwrapGeometry(applyPose(idler.model, idler.pose)));
  }
  assembly.push(unwrapGeometry(applyPose(train.output.model, train.output.pose)));
  return assembly;
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
