/* eslint-disable @typescript-eslint/no-require-imports */
const modeling = require("@jscad/modeling");

const { primitives, booleans, transforms, extrusions, hulls, colors, geometries } =
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
      return wrap(booleans.union(this, other));
    },
    subtract(other) {
      return wrap(booleans.subtract(this, other));
    },
    intersect(other) {
      return wrap(booleans.intersect(this, other));
    },
    unionForNonIntersecting(other) {
      return wrap(booleans.union(this, other));
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

const union = (...geometries) => wrap(booleans.union(...flatten(geometries)));
const difference = (base, ...cuts) =>
  wrap(booleans.subtract(base, ...flatten(cuts)));
const intersection = (...geometries) =>
  wrap(booleans.intersect(...flatten(geometries)));

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
  booleans
};

// Helper to unwrap geometries before serialization (removes wrapper methods)
api.unwrap = function(geometry) {
  if (!geometry) return geometry;
  if (Array.isArray(geometry)) {
    return geometry.map(g => api.unwrap(g));
  }
  if (typeof geometry === 'object' && geometry.__v1Wrapped) {
    // Create a clean copy without wrapper methods
    const clean = {};
    for (const key in geometry) {
      if (key !== '__v1Wrapped' && typeof geometry[key] !== 'function') {
        clean[key] = geometry[key];
      }
    }
    return clean;
  }
  return geometry;
};

const target = typeof globalThis !== "undefined" ? globalThis : {};
Object.assign(target, api);

module.exports = api;
