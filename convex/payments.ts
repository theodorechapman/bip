import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

function randomId(prefix: string): string {
  const values = new Uint8Array(8);
  crypto.getRandomValues(values);
  const hex = Array.from(values)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}_${hex}`;
}

function now(): number {
  return Date.now();
}

export const registerWallet = internalMutation({
  args: {
    userId: v.id("users"),
    chain: v.string(),
    address: v.string(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const createdAt = now();
    await ctx.db.insert("agentWallets", {
      userId: args.userId,
      chain: args.chain,
      address: args.address,
      label: args.label ?? null,
      createdAt,
    });
    return { ok: true, chain: args.chain, address: args.address };
  },
});

export const getLatestWallet = internalQuery({
  args: { userId: v.id("users"), chain: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("agentWallets")
      .withIndex("by_user_id_and_chain", (q) => q.eq("userId", args.userId).eq("chain", args.chain))
      .order("desc")
      .take(1);
    return rows[0] ?? null;
  },
});

export const createIntent = internalMutation({
  args: {
    userId: v.id("users"),
    task: v.string(),
    budgetUsd: v.number(),
    rail: v.string(),
  },
  handler: async (ctx, args) => {
    const createdAt = now();
    const intentId = randomId("pi");
    const approvalRequired = args.budgetUsd > 10;
    const status = approvalRequired ? "needs_approval" : "approved";

    await ctx.db.insert("paymentIntents", {
      userId: args.userId,
      intentId,
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
      payloadJson: JSON.stringify({ task: args.task, budgetUsd: args.budgetUsd, rail: args.rail, status }),
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

export const executeIntent = internalAction({
  args: { intentId: v.string() },
  handler: async (ctx, args) => {
    const intent = await ctx.runQuery(internal.payments.getIntent, { intentId: args.intentId });
    if (intent === null) throw new Error("Intent not found");
    if (intent.status !== "approved") throw new Error("Intent is not approved");

    const runId = randomId("run");
    const ts = now();

    const runDocId = await ctx.runMutation(internal.payments._insertRun, {
      runId,
      intentId: intent.intentId,
      userId: intent.userId,
      status: "ok",
      outputJson: JSON.stringify({ note: "execution stub: wire browser-use + rail adapter next" }),
      error: null,
      createdAt: ts,
      updatedAt: ts,
    });

    await ctx.runMutation(internal.payments._setIntentSubmitted, {
      intentId: intent.intentId,
      runId,
      updatedAt: ts,
    });

    await ctx.runMutation(internal.payments._recordEvent, {
      intentId: intent.intentId,
      eventType: "intent_executed",
      payloadJson: JSON.stringify({ runId, runDocId }),
      createdAt: ts,
    });

    return { runId, status: "ok" };
  },
});

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

export const _recordEvent = internalMutation({
  args: {
    intentId: v.string(),
    eventType: v.string(),
    payloadJson: v.string(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("paymentEvents", args);
    return { ok: true };
  },
});
