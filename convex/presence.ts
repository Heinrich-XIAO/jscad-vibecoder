import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const list = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    // Get all presence records for this project
    const presences = await ctx.db
      .query("presence")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    // Filter out stale presence (older than 5 minutes)
    const now = Date.now();
    const activePresences = presences.filter(
      (p) => now - p.lastSeen < 5 * 60 * 1000
    );

    return activePresences.map((p) => ({
      userId: p.userId,
      userName: p.userName,
      isEditing: p.isEditing,
      lastSeen: p.lastSeen,
    }));
  },
});

export const update = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.string(),
    userName: v.string(),
    isEditing: v.boolean(),
  },
  handler: async (ctx, args) => {
    // Check if presence record already exists
    const existing = await ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    if (existing) {
      // Update existing record
      await ctx.db.patch(existing._id, {
        projectId: args.projectId,
        userName: args.userName,
        isEditing: args.isEditing,
        lastSeen: Date.now(),
      });
    } else {
      // Create new presence record
      await ctx.db.insert("presence", {
        projectId: args.projectId,
        userId: args.userId,
        userName: args.userName,
        isEditing: args.isEditing,
        lastSeen: Date.now(),
      });
    }
  },
});

export const cleanup = mutation({
  args: {},
  handler: async (ctx) => {
    // Remove stale presence records (older than 10 minutes)
    const now = Date.now();
    const stalePresences = await ctx.db
      .query("presence")
      .filter((q) => q.lt(q.field("lastSeen"), now - 10 * 60 * 1000))
      .collect();

    for (const presence of stalePresences) {
      await ctx.db.delete(presence._id);
    }

    return { cleaned: stalePresences.length };
  },
});
