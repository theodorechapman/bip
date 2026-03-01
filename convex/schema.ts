import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    agentId: v.string(),
    email: v.union(v.string(), v.null()),
    phone: v.optional(v.union(v.string(), v.null())),
    createdAt: v.number(),
  })
    .index("by_agent_id", ["agentId"])
    .index("by_email", ["email"]),

  accessSessions: defineTable({
    userId: v.id("users"),
    tokenHash: v.string(),
    expiresAt: v.number(),
    revokedAt: v.union(v.number(), v.null()),
    maxApiCalls: v.number(),
    usedApiCalls: v.number(),
    lastUsedAt: v.union(v.number(), v.null()),
    createdAt: v.number(),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_user_id_and_created_at", ["userId", "createdAt"]),

  authAttempts: defineTable({
    action: v.literal("login"),
    subject: v.string(),
    ip: v.string(),
    createdAt: v.number(),
  })
    .index("by_action_and_subject_and_created_at", [
      "action",
      "subject",
      "createdAt",
    ])
    .index("by_action_and_ip_and_created_at", ["action", "ip", "createdAt"]),

  agentmailInboxes: defineTable({
    userId: v.id("users"),
    requestedEmail: v.string(),
    inboxId: v.string(),
    podId: v.string(),
    clientId: v.union(v.string(), v.null()),
    createdAt: v.number(),
  })
    .index("by_user_id_and_created_at", ["userId", "createdAt"])
    .index("by_user_id_and_inbox_id", ["userId", "inboxId"])
    .index("by_user_id_and_requested_email", ["userId", "requestedEmail"]),

  joltsmsNumbers: defineTable({
    userId: v.id("users"),
    numberId: v.string(),
    phoneNumber: v.string(),
    areaCode: v.union(v.string(), v.null()),
    createdAt: v.number(),
  })
    .index("by_user_id_and_created_at", ["userId", "createdAt"])
    .index("by_user_id_and_number_id", ["userId", "numberId"]),
});
