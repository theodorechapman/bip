import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { randomId, now, utcDayStartTs } from "./lib/paymentsUtils";
import {
  findPhase1Offering,
  normalizeLower,
  PHASE1_OFFERINGS,
  PHASE1_POLICY_DEFAULTS,
} from "./offerings";

export const createIntent = internalMutation({
  args: {
    userId: v.id("users"),
    task: v.string(),
    budgetUsd: v.number(),
    rail: v.string(),
    offeringId: v.optional(v.string()),
    intentType: v.optional(v.string()),
    provider: v.optional(v.string()),
    metadataJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const createdAt = now();
    const intentId = randomId("pi");
    const approvalRequired = args.budgetUsd > 10;
    const status = approvalRequired ? "needs_approval" : "approved";

    await ctx.db.insert("paymentIntents", {
      userId: args.userId,
      intentId,
      offeringId: args.offeringId ?? null,
      intentType: args.intentType ?? null,
      provider: args.provider ?? null,
      metadataJson: args.metadataJson ?? null,
      task: args.task,
      budgetUsd: args.budgetUsd,
      rail: args.rail,
      status,
      approvalRequired,
      approvedBy: null,
      runId: null,
      createdAt,
      updatedAt: createdAt,
    });

    await ctx.db.insert("paymentEvents", {
      intentId,
      eventType: "intent_created",
      payloadJson: JSON.stringify({
        task: args.task,
        budgetUsd: args.budgetUsd,
        rail: args.rail,
        status,
        offeringId: args.offeringId ?? null,
        intentType: args.intentType ?? null,
        provider: args.provider ?? null,
      }),
      createdAt,
    });

    return { intentId, status, approvalRequired };
  },
});

export const approveIntent = internalMutation({
  args: {
    intentId: v.string(),
    approvedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("paymentIntents")
      .withIndex("by_intent_id", (q) => q.eq("intentId", args.intentId))
      .unique();
    if (row === null) throw new Error("Intent not found");

    const updatedAt = now();
    await ctx.db.patch(row._id, {
      status: "approved",
      approvedBy: args.approvedBy,
      updatedAt,
    });

    await ctx.db.insert("paymentEvents", {
      intentId: args.intentId,
      eventType: "intent_approved",
      payloadJson: JSON.stringify({ approvedBy: args.approvedBy }),
      createdAt: updatedAt,
    });

    return { ok: true, intentId: args.intentId, status: "approved" };
  },
});

export const getIntent = internalQuery({
  args: { intentId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("paymentIntents")
      .withIndex("by_intent_id", (q) => q.eq("intentId", args.intentId))
      .unique();
  },
});

export const getRun = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("runs")
      .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
      .unique();
  },
});

export const getIntentEvents = internalQuery({
  args: { intentId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("paymentEvents")
      .withIndex("by_intent_id_and_created_at", (q) => q.eq("intentId", args.intentId))
      .order("asc")
      .collect();
  },
});

export const getIntentFundingLifecycle = internalQuery({
  args: {
    userId: v.id("users"),
    intentId: v.string(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_user_id_and_created_at", (q) => q.eq("userId", args.userId))
      .collect();
    let holdAmountCents = 0;
    let settledAmountCents = 0;
    let releasedAmountCents = 0;

    for (const row of rows) {
      if ((row.intentId ?? null) !== args.intentId) continue;
      if (row.type === "hold") {
        holdAmountCents += Math.abs(row.amountCents);
      } else if (row.type === "debit_settlement") {
        settledAmountCents += Math.abs(row.amountCents);
      } else if (row.type === "hold_release") {
        releasedAmountCents += Math.max(0, row.amountCents);
      }
    }

    const outstandingHoldCents = Math.max(
      0,
      holdAmountCents - settledAmountCents - releasedAmountCents,
    );
    const fundingStatus =
      holdAmountCents === 0
        ? "not_funded"
        : outstandingHoldCents > 0
          ? "held"
          : settledAmountCents > 0
            ? "settled"
            : "released";

    return {
      holdAmountCents,
      settledAmountCents,
      releasedAmountCents,
      fundingStatus,
    };
  },
});

export const getSpendSummary = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const ledger = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_user_id_and_created_at", (q) => q.eq("userId", args.userId))
      .collect();
    const intents = await ctx.db
      .query("paymentIntents")
      .withIndex("by_user_id_and_created_at", (q) => q.eq("userId", args.userId))
      .collect();

    const byIntentId = new Map(intents.map((intent) => [intent.intentId, intent]));
    let totalFunded = 0;
    let totalHeldGross = 0;
    let totalHeldReleased = 0;
    let totalHeldSettled = 0;
    let totalSettled = 0;
    const providerTotals = new Map<
      string,
      { totalBudgetCents: number; heldCents: number; settledCents: number; intentCount: number }
    >();
    const intentTypeTotals = new Map<
      string,
      { totalBudgetCents: number; heldCents: number; settledCents: number; intentCount: number }
    >();

    function bumpBucket(
      map: Map<
        string,
        { totalBudgetCents: number; heldCents: number; settledCents: number; intentCount: number }
      >,
      key: string,
      patch: Partial<{
        totalBudgetCents: number;
        heldCents: number;
        settledCents: number;
        intentCount: number;
      }>,
    ): void {
      const prior = map.get(key) ?? {
        totalBudgetCents: 0,
        heldCents: 0,
        settledCents: 0,
        intentCount: 0,
      };
      map.set(key, {
        totalBudgetCents: prior.totalBudgetCents + (patch.totalBudgetCents ?? 0),
        heldCents: prior.heldCents + (patch.heldCents ?? 0),
        settledCents: prior.settledCents + (patch.settledCents ?? 0),
        intentCount: prior.intentCount + (patch.intentCount ?? 0),
      });
    }

    for (const intent of intents) {
      const providerKey = normalizeLower(intent.provider ?? "unknown");
      const intentTypeKey = normalizeLower(intent.intentType ?? "unknown");
      const budgetCents = Math.max(0, Math.round(intent.budgetUsd * 100));
      bumpBucket(providerTotals, providerKey, { totalBudgetCents: budgetCents, intentCount: 1 });
      bumpBucket(intentTypeTotals, intentTypeKey, { totalBudgetCents: budgetCents, intentCount: 1 });
    }

    for (const entry of ledger) {
      if (entry.type === "deposit" && entry.amountCents > 0) {
        totalFunded += entry.amountCents;
      }

      const intentId = entry.intentId ?? null;
      if (intentId === null) continue;
      const intent = byIntentId.get(intentId) ?? null;
      const providerKey = normalizeLower(intent?.provider ?? "unknown");
      const intentTypeKey = normalizeLower(intent?.intentType ?? "unknown");

      if (entry.type === "hold") {
        const amount = Math.abs(entry.amountCents);
        totalHeldGross += amount;
        bumpBucket(providerTotals, providerKey, { heldCents: amount });
        bumpBucket(intentTypeTotals, intentTypeKey, { heldCents: amount });
      } else if (entry.type === "hold_release") {
        const amount = Math.max(0, entry.amountCents);
        totalHeldReleased += amount;
        bumpBucket(providerTotals, providerKey, { heldCents: -amount });
        bumpBucket(intentTypeTotals, intentTypeKey, { heldCents: -amount });
      } else if (entry.type === "debit_settlement") {
        const amount = Math.abs(entry.amountCents);
        totalHeldSettled += amount;
        totalSettled += amount;
        bumpBucket(providerTotals, providerKey, { heldCents: -amount, settledCents: amount });
        bumpBucket(intentTypeTotals, intentTypeKey, { heldCents: -amount, settledCents: amount });
      }
    }

    const totalHeld = Math.max(0, totalHeldGross - totalHeldReleased - totalHeldSettled);

    return {
      totalFunded,
      totalHeld,
      totalSettled,
      totalsByProvider: Object.fromEntries(providerTotals),
      totalsByIntentType: Object.fromEntries(intentTypeTotals),
      phase1OfferingCount: PHASE1_OFFERINGS.length,
    };
  },
});

export const resolveUserIdOrAgentId = internalQuery({
  args: {
    userIdOrAgentId: v.string(),
  },
  handler: async (ctx, args) => {
    const raw = args.userIdOrAgentId.trim();
    if (raw.length === 0) return null;
    const byAgent = await ctx.db
      .query("users")
      .withIndex("by_agent_id", (q) => q.eq("agentId", raw.toLowerCase()))
      .unique();
    if (byAgent !== null) {
      return {
        userId: byAgent._id,
        agentId: byAgent.agentId,
      };
    }
    const normalized = ctx.db.normalizeId("users", raw);
    if (normalized === null) return null;
    const byId = await ctx.db.get(normalized);
    if (byId === null) return null;
    return {
      userId: byId._id,
      agentId: byId.agentId,
    };
  },
});

export const seedPhase1OfferingPolicies = internalMutation({
  args: {},
  handler: async (ctx) => {
    const ts = now();
    let seededCount = 0;
    for (const defaultPolicy of PHASE1_POLICY_DEFAULTS) {
      const existing = await ctx.db
        .query("offeringPolicies")
        .withIndex("by_offering_id", (q) => q.eq("offeringId", defaultPolicy.offeringId))
        .unique();
      if (existing !== null) {
        await ctx.db.patch(existing._id, {
          intentType: defaultPolicy.intentType,
          providerAllowlist: defaultPolicy.providerAllowlist,
          maxBudgetCentsPerIntent: defaultPolicy.maxBudgetCentsPerIntent,
          maxBudgetCentsPerDay: defaultPolicy.maxBudgetCentsPerDay,
          enabled: defaultPolicy.enabled,
          updatedAt: ts,
        });
        seededCount += 1;
        continue;
      }
      await ctx.db.insert("offeringPolicies", {
        offeringId: defaultPolicy.offeringId,
        intentType: defaultPolicy.intentType,
        providerAllowlist: defaultPolicy.providerAllowlist,
        maxBudgetCentsPerIntent: defaultPolicy.maxBudgetCentsPerIntent,
        maxBudgetCentsPerDay: defaultPolicy.maxBudgetCentsPerDay,
        enabled: defaultPolicy.enabled,
        createdAt: ts,
        updatedAt: ts,
      });
      seededCount += 1;
    }
    return { ok: true, seededCount };
  },
});

export const listOfferingPolicies = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("offeringPolicies").collect();
  },
});

export const validateIntentAgainstPolicy = internalQuery({
  args: {
    userId: v.id("users"),
    intentType: v.string(),
    provider: v.string(),
    budgetUsd: v.number(),
  },
  handler: async (ctx, args) => {
    const intentTypeNorm = normalizeLower(args.intentType);
    const providerNorm = normalizeLower(args.provider);
    const offering = findPhase1Offering(intentTypeNorm, providerNorm);
    if (offering === null) {
      return {
        ok: false as const,
        code: "offering_not_found",
        error: "intentType/provider is not allowed by phase-1 offering registry",
      };
    }

    const policy = await ctx.db
      .query("offeringPolicies")
      .withIndex("by_offering_id", (q) => q.eq("offeringId", offering.offeringId))
      .unique();
    if (policy === null) {
      return {
        ok: false as const,
        code: "policy_not_found",
        error: "policy configuration missing for offering",
        offeringId: offering.offeringId,
      };
    }
    if (!policy.enabled) {
      return {
        ok: false as const,
        code: "offering_disabled",
        error: "offering is currently disabled by policy",
        offeringId: offering.offeringId,
      };
    }
    const providerAllowed = policy.providerAllowlist.some(
      (candidate) => normalizeLower(candidate) === providerNorm,
    );
    if (!providerAllowed) {
      return {
        ok: false as const,
        code: "provider_not_allowed",
        error: "provider is not in the allowlist for this offering",
        offeringId: offering.offeringId,
        provider: args.provider,
        providerAllowlist: policy.providerAllowlist,
      };
    }

    const requestedBudgetCents = Math.max(0, Math.round(args.budgetUsd * 100));
    if (requestedBudgetCents > policy.maxBudgetCentsPerIntent) {
      return {
        ok: false as const,
        code: "budget_cap_exceeded_per_intent",
        error: "requested budget exceeds per-intent cap",
        offeringId: offering.offeringId,
        requestedBudgetCents,
        maxBudgetCentsPerIntent: policy.maxBudgetCentsPerIntent,
      };
    }

    const dayStart = utcDayStartTs(now());
    const recentIntents = await ctx.db
      .query("paymentIntents")
      .withIndex("by_user_id_and_created_at", (q) =>
        q.eq("userId", args.userId).gte("createdAt", dayStart),
      )
      .collect();
    const consumedBudgetCentsToday = recentIntents
      .filter((intent) => {
        if ((intent.offeringId ?? null) === offering.offeringId) {
          return true;
        }
        return (
          normalizeLower(intent.intentType ?? "") === intentTypeNorm &&
          normalizeLower(intent.provider ?? "") === providerNorm
        );
      })
      .reduce((sum, intent) => sum + Math.max(0, Math.round(intent.budgetUsd * 100)), 0);

    const resultingBudgetCentsToday = consumedBudgetCentsToday + requestedBudgetCents;
    if (resultingBudgetCentsToday > policy.maxBudgetCentsPerDay) {
      return {
        ok: false as const,
        code: "budget_cap_exceeded_daily",
        error: "requested budget exceeds daily cap for offering",
        offeringId: offering.offeringId,
        requestedBudgetCents,
        consumedBudgetCentsToday,
        maxBudgetCentsPerDay: policy.maxBudgetCentsPerDay,
      };
    }

    return {
      ok: true as const,
      offeringId: offering.offeringId,
      policy: {
        offeringId: policy.offeringId,
        intentType: policy.intentType,
        providerAllowlist: policy.providerAllowlist,
        maxBudgetCentsPerIntent: policy.maxBudgetCentsPerIntent,
        maxBudgetCentsPerDay: policy.maxBudgetCentsPerDay,
        enabled: policy.enabled,
      },
    };
  },
});

// ── Internal run/intent state mutations ──

export const _insertRun = internalMutation({
  args: {
    runId: v.string(),
    intentId: v.string(),
    userId: v.id("users"),
    status: v.string(),
    outputJson: v.union(v.string(), v.null()),
    error: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("runs", args);
  },
});

export const _updateRun = internalMutation({
  args: {
    runId: v.string(),
    status: v.string(),
    outputJson: v.union(v.string(), v.null()),
    error: v.union(v.string(), v.null()),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("runs")
      .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
      .unique();
    if (run === null) throw new Error("Run not found");
    await ctx.db.patch(run._id, {
      status: args.status,
      outputJson: args.outputJson,
      error: args.error,
      updatedAt: args.updatedAt,
    });
    return { ok: true };
  },
});

export const _setIntentSubmitted = internalMutation({
  args: {
    intentId: v.string(),
    runId: v.string(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("paymentIntents")
      .withIndex("by_intent_id", (q) => q.eq("intentId", args.intentId))
      .unique();
    if (row === null) throw new Error("Intent not found");
    await ctx.db.patch(row._id, {
      status: "submitted",
      runId: args.runId,
      updatedAt: args.updatedAt,
    });
    return { ok: true };
  },
});

export const _setIntentStatus = internalMutation({
  args: {
    intentId: v.string(),
    status: v.string(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("paymentIntents")
      .withIndex("by_intent_id", (q) => q.eq("intentId", args.intentId))
      .unique();
    if (row === null) throw new Error("Intent not found");
    await ctx.db.patch(row._id, {
      status: args.status,
      updatedAt: args.updatedAt,
    });
    return { ok: true };
  },
});
