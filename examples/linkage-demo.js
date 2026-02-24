const { cuboid, cylinder } = require('@jscad/modeling').primitives
const { translate, rotateZ } = require('@jscad/modeling').transforms

function main() {
  // This demo matches the linkage inference example: 4 mm linear travel vs 50° rotation.
  const rack = translate([0, -2, 0], cuboid({ size: [20, 4, 4] }))
  const pinion = translate([10, 0, 0], rotateZ((50 * Math.PI) / 180, cylinder({ height: 10, radius: 4, segments: 64 })))

  return [rack, pinion]
}

module.exports = { main }
