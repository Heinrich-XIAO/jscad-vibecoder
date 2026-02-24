import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const list = query({
  args: {
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.category) {
      return await ctx.db
        .query("templates")
        .withIndex("by_category", (q) => q.eq("category", args.category!))
        .collect();
    }
    return await ctx.db.query("templates").collect();
  },
});

export const get = query({
  args: { id: v.id("templates") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    category: v.string(),
    jscadCode: v.string(),
    parameterSchema: v.optional(v.any()),
    thumbnailUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("templates", args);
  },
});

export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const templates = [
      {
        name: "Basic Box",
        description: "A simple parametric box with configurable dimensions",
        category: "Primitives",
        jscadCode: `const { cuboid } = require('@jscad/modeling').primitives

const getParameterDefinitions = () => [
  { name: 'width', type: 'float', initial: 30, caption: 'Width (mm)' },
  { name: 'depth', type: 'float', initial: 20, caption: 'Depth (mm)' },
  { name: 'height', type: 'float', initial: 15, caption: 'Height (mm)' },
]

const main = (params) => {
  const { width = 30, depth = 20, height = 15 } = params || {}
  return [cuboid({ size: [width, depth, height] })]
}

module.exports = { main, getParameterDefinitions }`,
        parameterSchema: {
          width: { type: "number", min: 1, max: 200, default: 30, label: "Width (mm)" },
          depth: { type: "number", min: 1, max: 200, default: 20, label: "Depth (mm)" },
          height: { type: "number", min: 1, max: 200, default: 15, label: "Height (mm)" },
        },
      },
      {
        name: "Rounded Box",
        description: "A box with rounded edges, great for enclosures",
        category: "Enclosures",
        jscadCode: `const { roundedCuboid } = require('@jscad/modeling').primitives

const getParameterDefinitions = () => [
  { name: 'width', type: 'float', initial: 50, caption: 'Width (mm)' },
  { name: 'depth', type: 'float', initial: 30, caption: 'Depth (mm)' },
  { name: 'height', type: 'float', initial: 20, caption: 'Height (mm)' },
  { name: 'roundRadius', type: 'float', initial: 2, caption: 'Corner Radius (mm)' },
]

const main = (params) => {
  const { width = 50, depth = 30, height = 20, roundRadius = 2 } = params || {}
  return [roundedCuboid({ size: [width, depth, height], roundRadius })]
}

module.exports = { main, getParameterDefinitions }`,
        parameterSchema: {
          width: { type: "number", min: 1, max: 200, default: 50, label: "Width (mm)" },
          depth: { type: "number", min: 1, max: 200, default: 30, label: "Depth (mm)" },
          height: { type: "number", min: 1, max: 200, default: 20, label: "Height (mm)" },
          roundRadius: { type: "number", min: 0.1, max: 20, default: 2, label: "Corner Radius (mm)" },
        },
      },
      {
        name: "Mounting Bracket",
        description: "L-shaped bracket with mounting holes",
        category: "Mechanical",
        jscadCode: `const { cuboid, cylinder } = require('@jscad/modeling').primitives
const { subtract, union } = require('@jscad/modeling').booleans
const { translate } = require('@jscad/modeling').transforms

const getParameterDefinitions = () => [
  { name: 'width', type: 'float', initial: 40, caption: 'Width (mm)' },
  { name: 'thickness', type: 'float', initial: 3, caption: 'Thickness (mm)' },
  { name: 'legHeight', type: 'float', initial: 25, caption: 'Leg Height (mm)' },
  { name: 'holeRadius', type: 'float', initial: 2.1, caption: 'Hole Radius (mm)' },
]

const main = (params) => {
  const { width = 40, thickness = 3, legHeight = 25, holeRadius = 2.1 } = params || {}
  
  const base = cuboid({ size: [width, width, thickness] })
  const leg = translate([0, -width/2 + thickness/2, legHeight/2 + thickness/2],
    cuboid({ size: [width, thickness, legHeight] })
  )
  const bracket = union(base, leg)
  
  const hole1 = translate([width/4, width/4, 0],
    cylinder({ radius: holeRadius, height: thickness + 1 })
  )
  const hole2 = translate([-width/4, width/4, 0],
    cylinder({ radius: holeRadius, height: thickness + 1 })
  )
  
  return [subtract(bracket, hole1, hole2)]
}

module.exports = { main, getParameterDefinitions }`,
        parameterSchema: {
          width: { type: "number", min: 10, max: 100, default: 40, label: "Width (mm)" },
          thickness: { type: "number", min: 1, max: 10, default: 3, label: "Thickness (mm)" },
          legHeight: { type: "number", min: 5, max: 100, default: 25, label: "Leg Height (mm)" },
          holeRadius: { type: "number", min: 0.5, max: 10, default: 2.1, label: "Hole Radius (mm)" },
        },
      },
      {
        name: "Linkage Inference Demo",
        description:
          "Visualizes the rack-and-pinion linkage that the new inference tool derives from paired start/end motions.",
        category: "Mechanisms",
        jscadCode: `const { cuboid, cylinder } = require('@jscad/modeling').primitives
const { translate, rotateX, rotateY, rotateZ } = require('@jscad/modeling').transforms

function normalizeCoords(coord) {
  const [x = 0, y = 0, z = 0, rotX = 0, rotY = 0, rotZ = 0] = coord || []
  return { x, y, z, rotX, rotY, rotZ }
}

function dominantLinear(motion) {
  const initial = normalizeCoords(motion.initial)
  const final = normalizeCoords(motion.final)
  const deltas = {
    x: final.x - initial.x,
    y: final.y - initial.y,
    z: final.z - initial.z,
  }
  return Object.entries(deltas).reduce(
    (best, [axis, value]) => (Math.abs(value) > Math.abs(best.delta) ? { axis, delta: value } : best),
    { axis: 'x', delta: deltas.x }
  )
}

function dominantRotation(motion) {
  const initial = normalizeCoords(motion.initial)
  const final = normalizeCoords(motion.final)
  const deltas = {
    rotX: final.rotX - initial.rotX,
    rotY: final.rotY - initial.rotY,
    rotZ: final.rotZ - initial.rotZ,
  }
  return Object.entries(deltas).reduce(
    (best, [axis, value]) => (Math.abs(value) > Math.abs(best.delta) ? { axis, delta: value } : best),
    { axis: 'rotZ', delta: deltas.rotZ }
  )
}

function linkage(motionA, motionB) {
  const translation = dominantLinear(motionA)
  const rotation = dominantRotation(motionB)
  const radians = (rotation.delta * Math.PI) / 180
  const pitchRadius = Math.abs(translation.delta / radians)
  return { translation, rotation, pitchRadius }
}

function rotateByAxis(axis, angle, geometry) {
  if (axis === 'rotX') return rotateX(angle, geometry)
  if (axis === 'rotY') return rotateY(angle, geometry)
  return rotateZ(angle, geometry)
}

function main() {
  const motionA = { initial: [0, -2, 0], final: [0, 2, 0] }
  const motionB = { initial: [10, 0, 0, 0, 0, 0], final: [10, 0, 0, 0, 0, 50] }
  const inferred = linkage(motionA, motionB)

  const rack = translate([0, -2, 0], cuboid({ size: [20, 4, 4] }))
  const pinion = translate(
    [10, 0, 2],
    rotateByAxis(
      inferred.rotation.axis,
      (inferred.rotation.delta * Math.PI) / 180,
      cylinder({ height: 8, radius: inferred.pitchRadius, segments: 64 })
    )
  )

  return [rack, pinion]
}

module.exports = { main }`,
      },
    ];

    const existingTemplates = await ctx.db.query("templates").collect();
    const existingByName = new Map(existingTemplates.map((template) => [template.name, template]));

    for (const t of templates) {
      const existingTemplate = existingByName.get(t.name);
      if (existingTemplate) {
        await ctx.db.patch(existingTemplate._id, {
          description: t.description,
          category: t.category,
          jscadCode: t.jscadCode,
          parameterSchema: t.parameterSchema,
        });
      } else {
        await ctx.db.insert("templates", t);
      }
    }
  },
});
