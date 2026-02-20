import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const list = query({
  args: {
    status: v.optional(
      v.union(v.literal("draft"), v.literal("active"), v.literal("archived"))
    ),
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.status) {
      return await ctx.db
        .query("projects")
        .withIndex("by_owner_status", (q) => 
          q.eq("ownerId", args.ownerId).eq("status", args.status!)
        )
        .order("desc")
        .collect();
    }
    return await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .order("desc")
      .collect();
  },
});

export const get = query({
  args: { id: v.id("projects"), ownerId: v.string() },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.id);
    if (!project) return null;
    
    if (project.ownerId !== args.ownerId) {
      return null;
    }

    let currentVersion = null;
    if (project.currentVersionId) {
      currentVersion = await ctx.db.get(project.currentVersionId);
    }

    return { ...project, currentVersion };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    templateId: v.optional(v.id("templates")),
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    let initialCode = `const { cuboid } = require('@jscad/modeling').primitives

const main = () => {
  return cuboid({ size: [20, 20, 20] })
}

module.exports = { main }
`;

    if (args.templateId) {
      const template = await ctx.db.get(args.templateId);
      if (template) {
        initialCode = template.jscadCode;
      }
    }

    const projectId = await ctx.db.insert("projects", {
      name: args.name,
      description: args.description,
      tags: args.tags ?? [],
      status: "active",
      ownerId: args.ownerId,
    });

    const versionId = await ctx.db.insert("versions", {
      projectId,
      versionNumber: 1,
      jscadCode: initialCode,
      source: "manual",
      isValid: true,
    });

    await ctx.db.patch(projectId, { currentVersionId: versionId });

    return projectId;
  },
});

export const update = mutation({
  args: {
    id: v.id("projects"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    status: v.optional(
      v.union(v.literal("draft"), v.literal("active"), v.literal("archived"))
    ),
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    const { id, ownerId, ...updates } = args;
    
    const project = await ctx.db.get(id);
    if (!project || project.ownerId !== ownerId) {
      return;
    }
    
    const filtered = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );
    await ctx.db.patch(id, filtered);
  },
});

export const remove = mutation({
  args: { id: v.id("projects"), ownerId: v.string() },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.id);
    if (!project || project.ownerId !== args.ownerId) {
      return;
    }
    
    // Delete all related data
    const versions = await ctx.db
      .query("versions")
      .withIndex("by_project", (q) => q.eq("projectId", args.id))
      .collect();
    for (const version of versions) {
      await ctx.db.delete(version._id);
    }

    const messages = await ctx.db
      .query("chatMessages")
      .withIndex("by_project", (q) => q.eq("projectId", args.id))
      .collect();
    for (const msg of messages) {
      await ctx.db.delete(msg._id);
    }

    const exports = await ctx.db
      .query("exports")
      .withIndex("by_project", (q) => q.eq("projectId", args.id))
      .collect();
    for (const exp of exports) {
      await ctx.db.delete(exp._id);
    }

    await ctx.db.delete(args.id);
  },
});
