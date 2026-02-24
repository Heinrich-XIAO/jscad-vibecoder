const { cuboid, cylinder } = require('@jscad/modeling').primitives
const { translate, rotateX, rotateY, rotateZ } = require('@jscad/modeling').transforms

function normalizeCoords(coord) {
  if (Array.isArray(coord)) {
    const [x = 0, y = 0, z = 0, rotX = 0, rotY = 0, rotZ = 0] = coord
    return { x, y, z, rotX, rotY, rotZ }
  }
  return { x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0 }
}

function dominantLinear({ initial, final }) {
  const init = normalizeCoords(initial)
  const end = normalizeCoords(final)
  const deltas = {
    x: end.x - init.x,
    y: end.y - init.y,
    z: end.z - init.z,
  }
  const axis = Object.entries(deltas).reduce((best, [axisName, delta]) => {
    if (Math.abs(delta) > Math.abs(best.delta)) {
      return { axis: axisName, delta }
    }
    return best
  }, { axis: 'x', delta: deltas.x })
  return { axis: axis.axis, delta: axis.delta, initial: init }
}

function dominantRotation({ initial, final }) {
  const init = normalizeCoords(initial)
  const end = normalizeCoords(final)
  const deltas = {
    rotX: end.rotX - init.rotX,
    rotY: end.rotY - init.rotY,
    rotZ: end.rotZ - init.rotZ,
  }
  const axis = Object.entries(deltas).reduce((best, [axisName, delta]) => {
    if (Math.abs(delta) > Math.abs(best.delta)) {
      return { axis: axisName, delta }
    }
    return best
  }, { axis: 'rotZ', delta: deltas.rotZ })
  return { axis: axis.axis, delta: axis.delta }
}

function linkage({ motionA, motionB }) {
  const translateMotion = dominantLinear(motionA)
  const rotateMotion = dominantRotation(motionB)

  const rotationDeltaRad = (rotateMotion.delta * Math.PI) / 180
  const pitchRadius = Math.abs(translateMotion.delta / rotationDeltaRad)

  return {
    translation: translateMotion,
    rotation: rotateMotion,
    pitchRadius,
    equations: {
      linearFromAngle: `translation = translation0 + ${translateMotion.delta.toFixed(3)} * (thetaDeg / ${rotateMotion.delta || 1})`,
      angleFromLinear: `thetaDeg = theta0 + ${(rotateMotion.delta / (translateMotion.delta || 1)).toFixed(3)} * translation`,
    },
  }
}

function applyRotation(axis, angleRad, geometry) {
  if (axis === 'rotX') return rotateX(angleRad, geometry)
  if (axis === 'rotY') return rotateY(angleRad, geometry)
  return rotateZ(angleRad, geometry)
}

function vectorForAxis(axis, values) {
  const result = [0, 0, 0]
  const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
  result[index] = values
  return result
}

function main() {
  const motionA = {
    initial: [0, -2, 0],
    final: [0, 2, 0],
  }
  const motionB = {
    initial: [10, 0, 0, 0, 0, 0],
    final: [10, 0, 0, 0, 0, 50],
  }

  const inference = linkage({ motionA, motionB })
  const rackCenter = vectorForAxis('y', motionA.initial[1])
  const rack = translate(rackCenter, cuboid({ size: [20, 4, 4] }))
  const pinionTransform = applyRotation(
    inference.rotation.axis,
    (inference.rotation.delta * Math.PI) / 180,
    cylinder({ height: 10, radius: inference.pitchRadius, segments: 64 })
  )
  const pinion = translate([10, 0, 0], pinionTransform)

  return [rack, pinion]
}

module.exports = { main }
