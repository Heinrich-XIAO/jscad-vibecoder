import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const list = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("exports")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .collect();
  },
});

export const create = mutation({
  args: {
    versionId: v.id("versions"),
    projectId: v.id("projects"),
    format: v.union(
      v.literal("stl"),
      v.literal("3mf"),
      v.literal("obj"),
      v.literal("svg"),
      v.literal("dxf")
    ),
    fileName: v.string(),
    fileId: v.optional(v.id("_storage")),
    fileSizeBytes: v.optional(v.number()),
    resolution: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("exports", args);
  },
});
