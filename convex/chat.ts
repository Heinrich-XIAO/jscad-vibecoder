import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const list = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("chatMessages")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("asc")
      .collect();
  },
});

export const send = mutation({
  args: {
    projectId: v.id("projects"),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system"), v.literal("tool")),
    content: v.string(),
    versionId: v.optional(v.id("versions")),
    toolCalls: v.optional(v.any()),
    toolResults: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("chatMessages", {
      projectId: args.projectId,
      role: args.role,
      content: args.content,
      versionId: args.versionId,
      toolCalls: args.toolCalls,
      toolResults: args.toolResults,
    });
  },
});

export const clearHistory = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("chatMessages")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const msg of messages) {
      await ctx.db.delete(msg._id);
    }
    // Re-add system message
    await ctx.db.insert("chatMessages", {
      projectId: args.projectId,
      role: "system",
      content:
        "Chat history cleared. Describe what you want to build and I'll generate JSCAD code for you.",
    });
  },
});
