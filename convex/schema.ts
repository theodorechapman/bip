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
    .index("by_intent_id_and_created_at", ["intentId", "createdAt"])
    .index("by_user_id_and_created_at", ["userId", "createdAt"])
    .index("by_ref_type_and_ref_id", ["refType", "refId"]),

  processedFundingTxs: defineTable({
    chain: v.string(),
    txSig: v.string(),
    userId: v.id("users"),
    walletAddress: v.string(),
    lamports: v.number(),
    amountCents: v.number(),
    slot: v.optional(v.number()),
    blockTime: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_chain_and_tx_sig", ["chain", "txSig"])
    .index("by_user_id_and_created_at", ["userId", "createdAt"]),

  paymentIntents: defineTable({
    userId: v.id("users"),
    intentId: v.string(),
    offeringId: v.optional(v.union(v.string(), v.null())),
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

  offeringPolicies: defineTable({
    offeringId: v.string(),
    intentType: v.string(),
    providerAllowlist: v.array(v.string()),
    maxBudgetCentsPerIntent: v.number(),
    maxBudgetCentsPerDay: v.number(),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_offering_id", ["offeringId"])
    .index("by_intent_type", ["intentType"]),

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
    .index("by_user_id_and_created_at", ["userId", "createdAt"])
    .index("by_secret_type_and_created_at", ["secretType", "createdAt"]),

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

  waitlistSignups: defineTable({
    email: v.string(),
    createdAt: v.number(),
  }).index("by_email", ["email"]),

  shopifyProducts: defineTable({
    userId: v.id("users"),
    cjProductId: v.string(),
    name: v.string(),
    description: v.string(),
    category: v.string(),
    supplierPrice: v.number(),
    retailPrice: v.number(),
    marginPct: v.number(),
    sku: v.string(),
    shopifyProductId: v.union(v.number(), v.null()),
    shopifyHandle: v.union(v.string(), v.null()),
    status: v.string(), // "sourced" | "listed" | "archived"
    imagesJson: v.string(), // JSON array of image URLs
    variantsJson: v.string(), // JSON array of variant objects
    sourceUrl: v.string(),
    shippingEstimateDays: v.number(),
    score: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_id_and_status", ["userId", "status"])
    .index("by_user_id_and_cj_product_id", ["userId", "cjProductId"])
    .index("by_user_id_and_shopify_product_id", ["userId", "shopifyProductId"]),

  shopifyOrders: defineTable({
    userId: v.id("users"),
    shopifyOrderId: v.number(),
    orderName: v.string(),
    totalPrice: v.string(),
    fulfillmentStatus: v.string(), // "pending" | "cj_placed" | "fulfilled" | "error"
    lineItemsJson: v.string(), // JSON array of per-line-item CJ order results
    shopifyFulfillmentId: v.union(v.number(), v.null()),
    trackingNumber: v.union(v.string(), v.null()),
    trackingCompany: v.union(v.string(), v.null()),
    error: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_id_and_status", ["userId", "fulfillmentStatus"])
    .index("by_user_id_and_shopify_order_id", ["userId", "shopifyOrderId"]),

  agentBrowserProfiles: defineTable({
    userId: v.id("users"),
    provider: v.string(),
    profileId: v.string(),
    createdAt: v.number(),
  })
    .index("by_user_id_and_provider", ["userId", "provider"])
    .index("by_user_id_and_created_at", ["userId", "createdAt"]),

  agentmailWebhookMessages: defineTable({
    inboxId: v.string(),
    messageId: v.string(),
    fromAddress: v.union(v.string(), v.null()),
    subject: v.union(v.string(), v.null()),
    textBody: v.union(v.string(), v.null()),
    htmlBody: v.union(v.string(), v.null()),
    receivedAt: v.number(),
    processed: v.boolean(),
  })
    .index("by_inbox_id", ["inboxId"])
    .index("by_inbox_id_and_processed", ["inboxId", "processed"])
    .index("by_message_id", ["messageId"]),
});
