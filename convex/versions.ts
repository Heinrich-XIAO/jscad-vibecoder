import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const list = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("versions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .collect();
  },
});

export const get = query({
  args: { id: v.id("versions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    jscadCode: v.string(),
    prompt: v.optional(v.string()),
    source: v.union(v.literal("ai"), v.literal("manual"), v.literal("parameter-tweak")),
    parameters: v.optional(v.any()),
    parameterSchema: v.optional(v.any()),
    metadata: v.optional(v.any()),
    isValid: v.boolean(),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Get the latest version number
    const existingVersions = await ctx.db
      .query("versions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();

    const versionNumber = existingVersions
      ? existingVersions.versionNumber + 1
      : 1;

    const project = await ctx.db.get(args.projectId);
    const parentVersionId = project?.currentVersionId ?? undefined;

    const versionId = await ctx.db.insert("versions", {
      projectId: args.projectId,
      parentVersionId,
      versionNumber,
      jscadCode: args.jscadCode,
      prompt: args.prompt,
      source: args.source,
      parameters: args.parameters,
      parameterSchema: args.parameterSchema,
      metadata: args.metadata,
      isValid: args.isValid,
      errorMessage: args.errorMessage,
    });

    // Update project's current version
    await ctx.db.patch(args.projectId, { currentVersionId: versionId });

    return versionId;
  },
});

export const updateMetadata = mutation({
  args: {
    id: v.id("versions"),
    metadata: v.optional(v.any()),
    isValid: v.optional(v.boolean()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const filtered = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );
    await ctx.db.patch(id, filtered);
  },
});
