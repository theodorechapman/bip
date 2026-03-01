import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    email: v.string(),
    createdAt: v.number(),
  }).index("by_email", ["email"]),

  otpChallenges: defineTable({
    email: v.string(),
    codeHash: v.string(),
    expiresAt: v.number(),
    attempts: v.number(),
    maxAttempts: v.number(),
    usedAt: v.union(v.number(), v.null()),
    createdAt: v.number(),
    // Backward compatibility for existing documents written before server-side captcha verification.
    captchaToken: v.optional(v.string()),
  }).index("by_email_and_created_at", ["email", "createdAt"]),

  accessSessions: defineTable({
    userId: v.id("users"),
    tokenHash: v.string(),
    expiresAt: v.number(),
    revokedAt: v.union(v.number(), v.null()),
    createdAt: v.number(),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_user_id_and_created_at", ["userId", "createdAt"]),

  refreshSessions: defineTable({
    userId: v.id("users"),
    tokenHash: v.string(),
    expiresAt: v.number(),
    revokedAt: v.union(v.number(), v.null()),
    replacedByTokenHash: v.union(v.string(), v.null()),
    createdAt: v.number(),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_user_id_and_created_at", ["userId", "createdAt"]),
});
