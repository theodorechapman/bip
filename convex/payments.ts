import { internal } from "./_generated/api";
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

function getPaymentsMode(): "free" | "metered" {
  const mode = (process.env.PAYMENTS_MODE ?? "free").trim().toLowerCase();
  return mode === "metered" ? "metered" : "free";
}

function getMinBudgetUsd(): number {
  const raw = Number(process.env.MIN_INTENT_BUDGET_USD ?? "1");
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

async function callBrowserUseTask(task: string): Promise<{
  ok: boolean;
  taskId?: string;
  output?: unknown;
  raw?: unknown;
  error?: string;
}> {
  const apiKey = process.env.BROWSER_USE_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "BROWSER_USE_API_KEY not configured" };
  }

  const base = process.env.BROWSER_USE_API_BASE?.trim() || "https://api.browser-use.com";

  // API v2 fallback path for broad compatibility.
  const createResp = await fetch(`${base}/api/v2/tasks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ task }),
  });

  if (!createResp.ok) {
    const err = await createResp.text();
    return { ok: false, error: `bu create task failed (${createResp.status}): ${err.slice(0, 400)}` };
  }

  const created = (await createResp.json()) as { id?: string; task_id?: string };
  const taskId = created.id ?? created.task_id;
  if (!taskId) return { ok: false, error: "bu task id missing in response", raw: created };

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const statusResp = await fetch(`${base}/api/v2/tasks/${taskId}/status`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!statusResp.ok) {
      const err = await statusResp.text();
      return { ok: false, error: `bu status failed (${statusResp.status}): ${err.slice(0, 400)}` };
    }

    const statusData = (await statusResp.json()) as {
      status?: string;
      output?: unknown;
      cost?: unknown;
      error?: unknown;
    };

    const status = (statusData.status ?? "").toString().toLowerCase();
    if (["finished", "completed", "succeeded", "success"].includes(status)) {
      return { ok: true, taskId, output: statusData.output, raw: statusData };
    }
    if (["failed", "error", "stopped", "cancelled", "canceled"].includes(status)) {
      return {
        ok: false,
        taskId,
        error: typeof statusData.error === "string" ? statusData.error : `task ${status}`,
        raw: statusData,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  return { ok: false, taskId, error: "bu task timeout after 60s" };
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

export const executeIntent = internalAction({
  args: { intentId: v.string() },
  handler: async (ctx, args) => {
    const intent = await ctx.runQuery(internal.payments.getIntent, { intentId: args.intentId });
    if (intent === null) throw new Error("Intent not found");
    if (intent.status !== "approved") throw new Error("Intent is not approved");

    const paymentsMode = getPaymentsMode();
    const minBudget = getMinBudgetUsd();
    if (paymentsMode === "metered" && intent.budgetUsd < minBudget) {
      const blockedAt = now();
      await ctx.runMutation(internal.payments._recordEvent, {
        intentId: intent.intentId,
        eventType: "payment_required",
        payloadJson: JSON.stringify({
          reason: "budget_below_minimum",
          minBudgetUsd: minBudget,
          providedBudgetUsd: intent.budgetUsd,
          mode: paymentsMode,
        }),
        createdAt: blockedAt,
      });
      await ctx.runMutation(internal.payments._setIntentStatus, {
        intentId: intent.intentId,
        status: "failed",
        updatedAt: blockedAt,
      });
      return {
        runId: null,
        status: "payment_required",
        error: "budget_below_minimum",
        minBudgetUsd: minBudget,
        providedBudgetUsd: intent.budgetUsd,
      };
    }

    const runId = randomId("run");
    const ts = now();

    await ctx.runMutation(internal.payments._insertRun, {
      runId,
      intentId: intent.intentId,
      userId: intent.userId,
      status: "running",
      outputJson: null,
      error: null,
      createdAt: ts,
      updatedAt: ts,
    });

    await ctx.runMutation(internal.payments._setIntentSubmitted, {
      intentId: intent.intentId,
      runId,
      updatedAt: ts,
    });

    const resolvedRail = intent.rail === "auto" ? "x402" : intent.rail;

    await ctx.runMutation(internal.payments._recordEvent, {
      intentId: intent.intentId,
      eventType: "intent_execution_started",
      payloadJson: JSON.stringify({ runId, rail: resolvedRail }),
      createdAt: ts,
    });

    if (["x402", "bitrefill", "card"].includes(resolvedRail) === false) {
      await ctx.runMutation(internal.payments._updateRun, {
        runId,
        status: "failed",
        outputJson: null,
        error: `unsupported_rail:${resolvedRail}`,
        updatedAt: ts,
      });
      await ctx.runMutation(internal.payments._setIntentStatus, {
        intentId: intent.intentId,
        status: "failed",
        updatedAt: ts,
      });
      await ctx.runMutation(internal.payments._recordEvent, {
        intentId: intent.intentId,
        eventType: "intent_execution_failed",
        payloadJson: JSON.stringify({ runId, error: `unsupported_rail:${resolvedRail}` }),
        createdAt: ts,
      });
      return { runId, status: "failed", error: `unsupported_rail:${resolvedRail}` };
    }

    await ctx.runMutation(internal.payments._recordEvent, {
      intentId: intent.intentId,
      eventType: "rail_selected",
      payloadJson: JSON.stringify({ runId, rail: resolvedRail, mode: paymentsMode }),
      createdAt: ts,
    });

    const buTask = `[rail=${resolvedRail}] ${intent.task}`;
    const buResult = await callBrowserUseTask(buTask);
    const doneTs = now();

    if (!buResult.ok) {
      await ctx.runMutation(internal.payments._updateRun, {
        runId,
        status: "failed",
        outputJson: buResult.raw ? JSON.stringify(buResult.raw) : null,
        error: buResult.error ?? "execution_failed",
        updatedAt: doneTs,
      });

      await ctx.runMutation(internal.payments._setIntentStatus, {
        intentId: intent.intentId,
        status: "failed",
        updatedAt: doneTs,
      });

      await ctx.runMutation(internal.payments._recordEvent, {
        intentId: intent.intentId,
        eventType: "intent_execution_failed",
        payloadJson: JSON.stringify({ runId, error: buResult.error, taskId: buResult.taskId ?? null }),
        createdAt: doneTs,
      });

      return { runId, status: "failed", error: buResult.error, taskId: buResult.taskId ?? null };
    }

    await ctx.runMutation(internal.payments._updateRun, {
      runId,
      status: "ok",
      outputJson: JSON.stringify({ taskId: buResult.taskId ?? null, output: buResult.output ?? null, raw: buResult.raw ?? null }),
      error: null,
      updatedAt: doneTs,
    });

    await ctx.runMutation(internal.payments._setIntentStatus, {
      intentId: intent.intentId,
      status: "confirmed",
      updatedAt: doneTs,
    });

    await ctx.runMutation(internal.payments._recordEvent, {
      intentId: intent.intentId,
      eventType: "intent_execution_confirmed",
      payloadJson: JSON.stringify({ runId, taskId: buResult.taskId ?? null }),
      createdAt: doneTs,
    });

    return { runId, status: "ok", taskId: buResult.taskId ?? null, output: buResult.output ?? null };
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
