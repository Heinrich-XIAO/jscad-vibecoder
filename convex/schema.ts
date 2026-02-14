import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  projects: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    tags: v.array(v.string()),
    status: v.union(v.literal("draft"), v.literal("active"), v.literal("archived")),
    currentVersionId: v.optional(v.id("versions")),
    thumbnailUrl: v.optional(v.string()),
  })
    .index("by_status", ["status"]),

  versions: defineTable({
    projectId: v.id("projects"),
    parentVersionId: v.optional(v.id("versions")),
    versionNumber: v.number(),
    jscadCode: v.string(),
    prompt: v.optional(v.string()),
    source: v.union(v.literal("ai"), v.literal("manual"), v.literal("parameter-tweak")),
    parameters: v.optional(v.any()),
    parameterSchema: v.optional(v.any()),
    metadata: v.optional(
      v.object({
        boundingBox: v.optional(v.any()),
        volume: v.optional(v.number()),
        surfaceArea: v.optional(v.number()),
        polygonCount: v.optional(v.number()),
      })
    ),
    isValid: v.boolean(),
    errorMessage: v.optional(v.string()),
  })
    .index("by_project", ["projectId"])
    .index("by_project_version", ["projectId", "versionNumber"]),

  chatMessages: defineTable({
    projectId: v.id("projects"),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system"), v.literal("tool")),
    content: v.string(),
    versionId: v.optional(v.id("versions")),
    toolCalls: v.optional(v.any()),
    toolResults: v.optional(v.any()),
  })
    .index("by_project", ["projectId"]),

  exports: defineTable({
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
  })
    .index("by_project", ["projectId"])
    .index("by_version", ["versionId"]),

  templates: defineTable({
    name: v.string(),
    description: v.string(),
    category: v.string(),
    jscadCode: v.string(),
    parameterSchema: v.optional(v.any()),
    thumbnailUrl: v.optional(v.string()),
  })
    .index("by_category", ["category"]),

  presence: defineTable({
    projectId: v.id("projects"),
    userId: v.string(),
    userName: v.string(),
    isEditing: v.boolean(),
    lastSeen: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_user", ["userId"]),
});
