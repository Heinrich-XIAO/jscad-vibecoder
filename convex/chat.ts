import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

async function ensureProjectOwner(ctx: { db: any }, projectId: string, ownerId: string) {
  const project = await ctx.db.get(projectId);
  if (!project || project.ownerId !== ownerId) {
    throw new Error("Project not found");
  }
  return project;
}

export const list = query({
  args: {
    projectId: v.id("projects"),
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.ownerId !== args.ownerId) {
      return [];
    }

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
    ownerId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system"), v.literal("tool")),
    content: v.string(),
    versionId: v.optional(v.id("versions")),
    toolCalls: v.optional(v.any()),
    toolResults: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ensureProjectOwner(ctx, args.projectId, args.ownerId);

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

export const enqueuePrompt = mutation({
  args: {
    projectId: v.id("projects"),
    ownerId: v.string(),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureProjectOwner(ctx, args.projectId, args.ownerId);

    const now = Date.now();
    const userMessageId = await ctx.db.insert("chatMessages", {
      projectId: args.projectId,
      role: "user",
      content: args.prompt,
    });

    const queueId = await ctx.db.insert("promptQueue", {
      projectId: args.projectId,
      ownerId: args.ownerId,
      prompt: args.prompt,
      userMessageId,
      status: "queued",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });

    return {
      messageId: userMessageId,
      queueId,
    };
  },
});

export const listQueue = query({
  args: {
    projectId: v.id("projects"),
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureProjectOwner(ctx, args.projectId, args.ownerId);

    const queued = await ctx.db
      .query("promptQueue")
      .withIndex("by_project_status_createdAt", (q) =>
        q.eq("projectId", args.projectId).eq("status", "queued")
      )
      .order("asc")
      .collect();

    const running = await ctx.db
      .query("promptQueue")
      .withIndex("by_project_status_createdAt", (q) =>
        q.eq("projectId", args.projectId).eq("status", "running")
      )
      .order("asc")
      .collect();

    return {
      queuedCount: queued.length,
      runningCount: running.length,
      nextQueuedPrompt: queued[0]?.prompt ?? null,
      activePrompt: running[0]?.prompt ?? null,
    };
  },
});

export const claimNextPrompt = mutation({
  args: {
    projectId: v.id("projects"),
    ownerId: v.string(),
    staleAfterMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ensureProjectOwner(ctx, args.projectId, args.ownerId);

    const now = Date.now();
    const staleAfterMs = Math.max(args.staleAfterMs ?? 15000, 1000);
    const staleCutoff = now - staleAfterMs;

    const running = await ctx.db
      .query("promptQueue")
      .withIndex("by_project_status_createdAt", (q) =>
        q.eq("projectId", args.projectId).eq("status", "running")
      )
      .order("asc")
      .collect();

    for (const item of running) {
      const heartbeat = item.heartbeatAt ?? item.startedAt ?? item.updatedAt;
      if (heartbeat > staleCutoff) {
        return null;
      }

      await ctx.db.patch(item._id, {
        status: "queued",
        startedAt: undefined,
        heartbeatAt: undefined,
        updatedAt: now,
      });
    }

    const next = await ctx.db
      .query("promptQueue")
      .withIndex("by_project_status_createdAt", (q) =>
        q.eq("projectId", args.projectId).eq("status", "queued")
      )
      .order("asc")
      .first();

    if (!next) {
      return null;
    }

    await ctx.db.patch(next._id, {
      status: "running",
      attempts: next.attempts + 1,
      startedAt: now,
      heartbeatAt: now,
      updatedAt: now,
      error: undefined,
    });

    return {
      queueId: next._id,
      prompt: next.prompt,
    };
  },
});

export const heartbeatPrompt = mutation({
  args: {
    queueId: v.id("promptQueue"),
    projectId: v.id("projects"),
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureProjectOwner(ctx, args.projectId, args.ownerId);
    const item = await ctx.db.get(args.queueId);
    if (!item || item.projectId !== args.projectId) {
      return;
    }
    if (item.status !== "running") {
      return;
    }
    const now = Date.now();
    await ctx.db.patch(item._id, {
      heartbeatAt: now,
      updatedAt: now,
    });
  },
});

export const completePrompt = mutation({
  args: {
    queueId: v.id("promptQueue"),
    projectId: v.id("projects"),
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureProjectOwner(ctx, args.projectId, args.ownerId);
    const item = await ctx.db.get(args.queueId);
    if (!item || item.projectId !== args.projectId) {
      return;
    }

    const now = Date.now();
    await ctx.db.patch(item._id, {
      status: "completed",
      completedAt: now,
      heartbeatAt: now,
      updatedAt: now,
      error: undefined,
    });
  },
});

export const failPrompt = mutation({
  args: {
    queueId: v.id("promptQueue"),
    projectId: v.id("projects"),
    ownerId: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureProjectOwner(ctx, args.projectId, args.ownerId);
    const item = await ctx.db.get(args.queueId);
    if (!item || item.projectId !== args.projectId) {
      return;
    }

    const now = Date.now();
    await ctx.db.patch(item._id, {
      status: "failed",
      error: args.error,
      completedAt: now,
      heartbeatAt: now,
      updatedAt: now,
    });
  },
});

export const clearHistory = mutation({
  args: { projectId: v.id("projects"), ownerId: v.string() },
  handler: async (ctx, args) => {
    await ensureProjectOwner(ctx, args.projectId, args.ownerId);
    const messages = await ctx.db
      .query("chatMessages")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const msg of messages) {
      await ctx.db.delete(msg._id);
    }
    const queued = await ctx.db
      .query("promptQueue")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const item of queued) {
      await ctx.db.delete(item._id);
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
