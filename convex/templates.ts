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
        name: "Linkage Demo",
        description:
          "Uses built-in coord() and linkage() helpers to drive a rack-and-pinion pair from endpoint motions.",
        category: "Mechanisms",
        jscadCode: `function getParameterDefinitions() {
  return [
    { name: 'progress', type: 'float', initial: 0, min: 0, max: 1, step: 0.01, caption: 'Progress' },
  ]
}

function main(params) {
  const { progress = 0 } = params || {}
  return linkage(
    { initial: coord(0, 0, 0), final: coord(Math.PI, 0, 0) },
    { initial: coord(3 * Math.PI, 0, 0, 0, 0, 0), final: coord(3 * Math.PI, 0, 0, 0, 0, 18) },
    { progress }
  )
}

module.exports = { main, getParameterDefinitions }`,
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
    ];

    const existingTemplates = await ctx.db.query("templates").collect();
    const existingByName = new Map(existingTemplates.map((template) => [template.name, template]));

    for (const existingTemplate of existingTemplates) {
      if (existingTemplate.name === "Rounded Box" || existingTemplate.name === "Basic Box") {
        await ctx.db.delete(existingTemplate._id);
      }
    }

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
