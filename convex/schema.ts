import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    agentId: v.string(),
    email: v.union(v.string(), v.null()),
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

  agentWallets: defineTable({
    userId: v.id("users"),
    chain: v.string(),
    address: v.string(),
    label: v.union(v.string(), v.null()),
    createdAt: v.number(),
  })
    .index("by_user_id_and_created_at", ["userId", "createdAt"])
    .index("by_user_id_and_chain", ["userId", "chain"]),

  agentAccounts: defineTable({
    userId: v.id("users"),
    currency: v.string(),
    availableCents: v.number(),
    heldCents: v.number(),
    status: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user_id", ["userId"]),

  ledgerEntries: defineTable({
    entryId: v.string(),
    userId: v.id("users"),
    intentId: v.optional(v.string()),
    type: v.string(),
    amountCents: v.number(),
    balanceAfterAvailableCents: v.number(),
    balanceAfterHeldCents: v.number(),
    refType: v.optional(v.string()),
    refId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_entry_id", ["entryId"])
    .index("by_user_id_and_created_at", ["userId", "createdAt"]),

  paymentIntents: defineTable({
    userId: v.id("users"),
    intentId: v.string(),
    intentType: v.optional(v.union(v.string(), v.null())),
    provider: v.optional(v.union(v.string(), v.null())),
    metadataJson: v.optional(v.union(v.string(), v.null())),
    task: v.string(),
    budgetUsd: v.number(),
    rail: v.string(),
    status: v.string(),
    approvalRequired: v.boolean(),
    approvedBy: v.union(v.string(), v.null()),
    runId: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_intent_id", ["intentId"])
    .index("by_user_id_and_created_at", ["userId", "createdAt"]),

  paymentEvents: defineTable({
    intentId: v.string(),
    eventType: v.string(),
    payloadJson: v.string(),
    createdAt: v.number(),
  }).index("by_intent_id_and_created_at", ["intentId", "createdAt"]),

  agentSecrets: defineTable({
    secretRef: v.string(),
    userId: v.id("users"),
    intentId: v.optional(v.string()),
    provider: v.optional(v.string()),
    secretType: v.string(),
    secretValue: v.string(),
    createdAt: v.number(),
  })
    .index("by_secret_ref", ["secretRef"])
    .index("by_user_id_and_created_at", ["userId", "createdAt"]),

  runs: defineTable({
    runId: v.string(),
    intentId: v.string(),
    userId: v.id("users"),
    status: v.string(),
    outputJson: v.union(v.string(), v.null()),
    error: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_run_id", ["runId"])
    .index("by_intent_id", ["intentId"]),
});
