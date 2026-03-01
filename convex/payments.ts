import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { Keypair } from "@solana/web3.js";

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


type TracePhase = "started" | "rail_selected" | "failed" | "confirmed";

async function postJson(url: string, payload: unknown, headers: Record<string, string>): Promise<void> {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`trace sink failed (${resp.status}): ${body.slice(0, 240)}`);
  }
}

async function emitExternalTrace(event: {
  traceId: string;
  runId: string;
  intentId: string;
  phase: TracePhase;
  status: string;
  rail?: string;
  budgetUsd?: number;
  task?: string;
  taskId?: string | null;
  error?: string | null;
  startedAt?: number;
  endedAt?: number;
}): Promise<void> {
  const laminarUrl = (process.env.LAMINAR_INGEST_URL ?? "").trim();
  const laminarApiKey = (process.env.LAMINAR_API_KEY ?? "").trim();
  const hudUrl = (process.env.HUD_TRACE_URL ?? "").trim();
  const hudApiKey = (process.env.HUD_API_KEY ?? "").trim();

  const payload = {
    source: "bip",
    ts: Date.now(),
    ...event,
  };

  const writes: Promise<void>[] = [];
  if (laminarUrl) {
    writes.push(postJson(laminarUrl, payload, laminarApiKey ? { Authorization: `Bearer ${laminarApiKey}` } : {}));
  }
  if (hudUrl) {
    writes.push(postJson(hudUrl, payload, hudApiKey ? { Authorization: `Bearer ${hudApiKey}` } : {}));
  }
  if (writes.length === 0) return;

  const settled = await Promise.allSettled(writes);
  const err = settled.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  if (err) {
    console.error("[trace] emit failed", err.reason);
  }
}

async function callBrowserUseTask(task: string, apiKeyOverride?: string): Promise<{
  ok: boolean;
  taskId?: string;
  output?: unknown;
  raw?: unknown;
  error?: string;
}> {
  const apiKey = (apiKeyOverride ?? process.env.BROWSER_USE_API_KEY ?? "").trim();
  if (!apiKey) {
    return { ok: false, error: "BROWSER_USE_API_KEY not configured" };
  }

  const base = process.env.BROWSER_USE_API_BASE?.trim() || "https://api.browser-use.com";

  // API v2 fallback path for broad compatibility.
  const createResp = await fetch(`${base}/api/v2/tasks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Browser-Use-API-Key": apiKey,
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

  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    const statusResp = await fetch(`${base}/api/v2/tasks/${taskId}/status`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Browser-Use-API-Key": apiKey,
      },
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

  return { ok: false, taskId, error: "bu task timeout after 240s", raw: { status: "timeout" } };
}




async function callBitrefillPurchase(input: { productId?: string; amount?: number; recipientEmail?: string; note?: string }): Promise<{ ok: boolean; orderId?: string; code?: string; raw?: unknown; error?: string; }> {
  const apiKey = (process.env.BITREFILL_API_KEY ?? "").trim();
  if (!apiKey) return { ok: false, error: "BITREFILL_API_KEY not configured" };
  const base = (process.env.BITREFILL_API_BASE ?? "https://api.bitrefill.com").trim();

  const createResp = await fetch(`${base}/v2/orders`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      productId: input.productId,
      amount: input.amount,
      recipientEmail: input.recipientEmail,
      note: input.note,
    }),
  });

  const bodyText = await createResp.text();
  let body: any = null;
  try { body = bodyText ? JSON.parse(bodyText) : null; } catch { body = { raw: bodyText }; }
  if (!createResp.ok) {
    return { ok: false, error: `bitrefill order failed (${createResp.status})`, raw: body };
  }

  const orderId = body?.id ?? body?.orderId ?? null;
  const code = body?.code ?? body?.voucherCode ?? body?.claimCode ?? null;
  return { ok: true, orderId: orderId ?? undefined, code: code ?? undefined, raw: body };
}
function buildBrowserUseHandoffUrl(taskId: string | undefined): string | null {
  if (!taskId) return null;
  const template = (process.env.BROWSER_USE_TASK_URL_TEMPLATE ?? "https://cloud.browser-use.com/tasks/{taskId}").trim();
  if (!template) return null;
  return template.replaceAll("{taskId}", taskId);
}

function outputSuggestsManualIntervention(output: unknown): boolean {
  if (typeof output !== "string") return false;
  const t = output.toLowerCase();
  return (
    t.includes("need you to log in") ||
    t.includes("please log in") ||
    t.includes("need to be logged") ||
    t.includes("sign-in") ||
    t.includes("sign in") ||
    t.includes("requires a login") ||
    t.includes("captcha") ||
    t.includes("2fa") ||
    t.includes("two-factor") ||
    t.includes("verification code")
  );
}

function extractLikelyApiKey(output: unknown): string | null {
  if (typeof output !== "string") return null;
  const patterns = [/(sk-[A-Za-z0-9_\-]{12,})/, /(or-[A-Za-z0-9_\-]{12,})/, /(rk_[A-Za-z0-9_\-]{12,})/];
  for (const p of patterns) {
    const m = output.match(p);
    if (m && m[1]) return m[1];
  }
  return null;
}

export const generateWallet = internalMutation({
  args: {
    userId: v.id("users"),
    chain: v.string(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const createdAt = now();
    if (args.chain !== "solana") {
      throw new Error("only solana wallet generation is currently supported");
    }
    const kp = Keypair.generate();
    const address = kp.publicKey.toBase58();
    const secretRef = randomId("sec");
    await ctx.db.insert("agentWallets", {
      userId: args.userId,
      chain: args.chain,
      address,
      label: args.label ?? null,
      createdAt,
    });
    await ctx.db.insert("agentSecrets", {
      secretRef,
      userId: args.userId,
      intentId: undefined,
      provider: "wallet",
      secretType: "solana_private_key_base64",
      secretValue: Array.from(kp.secretKey).map((b) => b.toString(16).padStart(2, "0")).join(""),
      createdAt,
    });
    return { ok: true, chain: args.chain, address, secretRef };
  },
});

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

export const executeIntent = internalAction({
  args: { intentId: v.string(), apiKey: v.optional(v.string()) },
  handler: async (ctx, args): Promise<any> => {
    const payments: any = (internal as any).payments;
    const intent = await ctx.runQuery(payments.getIntent, { intentId: args.intentId });
    if (intent === null) throw new Error("Intent not found");
    if (intent.status !== "approved") throw new Error("Intent is not approved");

    const paymentsMode = getPaymentsMode();
    const minBudget = getMinBudgetUsd();
    if (paymentsMode === "metered" && intent.budgetUsd < minBudget) {
      const blockedAt = now();
      await ctx.runMutation(payments._recordEvent, {
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
      await ctx.runMutation(payments._setIntentStatus, {
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

    const holdAmountCents = Math.max(1, Math.round(intent.budgetUsd * 100));
    const holdResult = await ctx.runMutation(payments._holdFundsForIntent, {
      userId: intent.userId,
      intentId: intent.intentId,
      amountCents: holdAmountCents,
    });
    if (!holdResult.ok) {
      const blockedAt = now();
      await ctx.runMutation(payments._recordEvent, {
        intentId: intent.intentId,
        eventType: "payment_required",
        payloadJson: JSON.stringify({
          reason: "insufficient_funds",
          requiredCents: holdAmountCents,
          availableCents: holdResult.availableCents,
        }),
        createdAt: blockedAt,
      });
      await ctx.runMutation(payments._setIntentStatus, {
        intentId: intent.intentId,
        status: "failed",
        updatedAt: blockedAt,
      });
      return {
        runId: null,
        status: "payment_required",
        error: "insufficient_funds",
        requiredCents: holdAmountCents,
        availableCents: holdResult.availableCents,
      };
    }

    const runId = randomId("run");
    const traceId = `tr_${runId}`;
    const ts = now();

    await ctx.runMutation(payments._insertRun, {
      runId,
      intentId: intent.intentId,
      userId: intent.userId,
      status: "running",
      outputJson: null,
      error: null,
      createdAt: ts,
      updatedAt: ts,
    });

    await ctx.runMutation(payments._setIntentSubmitted, {
      intentId: intent.intentId,
      runId,
      updatedAt: ts,
    });

    const resolvedRail = intent.rail === "auto" ? "x402" : intent.rail;

    await ctx.runMutation(payments._recordEvent, {
      intentId: intent.intentId,
      eventType: "intent_execution_started",
      payloadJson: JSON.stringify({ runId, traceId, rail: resolvedRail }),
      createdAt: ts,
    });

    await emitExternalTrace({
      traceId,
      runId,
      intentId: intent.intentId,
      phase: "started",
      status: "running",
      rail: resolvedRail,
      budgetUsd: intent.budgetUsd,
      task: intent.task,
      startedAt: ts,
    });

    if (["x402", "bitrefill", "card"].includes(resolvedRail) === false) {
      await ctx.runMutation(payments._updateRun, {
        runId,
        status: "failed",
        outputJson: null,
        error: `unsupported_rail:${resolvedRail}`,
        updatedAt: ts,
      });
      await ctx.runMutation(payments._setIntentStatus, {
        intentId: intent.intentId,
        status: "failed",
        updatedAt: ts,
      });
      await ctx.runMutation(payments._recordEvent, {
        intentId: intent.intentId,
        eventType: "intent_execution_failed",
        payloadJson: JSON.stringify({ runId, error: `unsupported_rail:${resolvedRail}` }),
        createdAt: ts,
      });
      return { runId, status: "failed", error: `unsupported_rail:${resolvedRail}` };
    }

    await ctx.runMutation(payments._recordEvent, {
      intentId: intent.intentId,
      eventType: "rail_selected",
      payloadJson: JSON.stringify({ runId, traceId, rail: resolvedRail, mode: paymentsMode }),
      createdAt: ts,
    });

    await emitExternalTrace({
      traceId,
      runId,
      intentId: intent.intentId,
      phase: "rail_selected",
      status: "running",
      rail: resolvedRail,
      budgetUsd: intent.budgetUsd,
      task: intent.task,
      startedAt: ts,
    });

    // Real bitrefill adapter path (if selected)
    if (resolvedRail === "bitrefill") {
      let meta: any = null;
      try { meta = intent.metadataJson ? JSON.parse(intent.metadataJson) : null; } catch { meta = null; }
      const br = await callBitrefillPurchase({
        productId: meta?.productId,
        amount: typeof meta?.amount === "number" ? meta.amount : intent.budgetUsd,
        recipientEmail: typeof meta?.recipientEmail === "string" ? meta.recipientEmail : undefined,
        note: typeof meta?.note === "string" ? meta.note : undefined,
      });
      const doneTs = now();
      if (!br.ok) {
        await ctx.runMutation(payments._updateRun, {
          runId,
          status: "failed",
          outputJson: br.raw ? JSON.stringify(br.raw) : null,
          error: br.error ?? "bitrefill_failed",
          updatedAt: doneTs,
        });
        await ctx.runMutation(payments._releaseHeldFundsForIntent, {
          userId: intent.userId,
          intentId: intent.intentId,
          amountCents: holdAmountCents,
          refType: "execution_failed",
          refId: runId,
        });
        await ctx.runMutation(payments._setIntentStatus, {
          intentId: intent.intentId,
          status: "failed",
          updatedAt: doneTs,
        });
        await ctx.runMutation(payments._recordEvent, {
          intentId: intent.intentId,
          eventType: "intent_execution_failed",
          payloadJson: JSON.stringify({ runId, error: br.error ?? "bitrefill_failed" }),
          createdAt: doneTs,
        });
        return { runId, status: "failed", error: br.error ?? "bitrefill_failed" };
      }

      await ctx.runMutation(payments._updateRun, {
        runId,
        status: "ok",
        outputJson: JSON.stringify({ rail: "bitrefill", orderId: br.orderId ?? null, code: br.code ?? null, raw: br.raw ?? null }),
        error: null,
        updatedAt: doneTs,
      });
      await ctx.runMutation(payments._settleHeldFundsForIntent, {
        userId: intent.userId,
        intentId: intent.intentId,
        amountCents: holdAmountCents,
        refType: "bitrefill_order",
        refId: br.orderId ?? runId,
      });
      await ctx.runMutation(payments._setIntentStatus, {
        intentId: intent.intentId,
        status: "confirmed",
        updatedAt: doneTs,
      });
      await ctx.runMutation(payments._recordEvent, {
        intentId: intent.intentId,
        eventType: "intent_execution_confirmed",
        payloadJson: JSON.stringify({ runId, rail: "bitrefill", orderId: br.orderId ?? null }),
        createdAt: doneTs,
      });
      return { runId, status: "ok", rail: "bitrefill", orderId: br.orderId ?? null, code: br.code ?? null, traceId };
    }

    const buTask = `[rail=${resolvedRail}] ${intent.task}`;
    const buResult = await callBrowserUseTask(buTask, args.apiKey);
    const doneTs = now();

    if (!buResult.ok) {
      const handoffUrl = buildBrowserUseHandoffUrl(buResult.taskId);
      const isRecoverable = (intent.intentType === "account_bootstrap" || intent.intentType === "api_key_purchase") && (buResult.error ?? "").toLowerCase().includes("timeout");
      if (isRecoverable) {
        await ctx.runMutation(payments._updateRun, {
          runId,
          status: "action_required",
          outputJson: JSON.stringify({ taskId: buResult.taskId ?? null, handoffUrl, raw: buResult.raw ?? null }),
          error: buResult.error ?? "execution_timeout",
          updatedAt: doneTs,
        });
        await ctx.runMutation(payments._setIntentStatus, {
          intentId: intent.intentId,
          status: "action_required",
          updatedAt: doneTs,
        });
        await ctx.runMutation(payments._recordEvent, {
          intentId: intent.intentId,
          eventType: "intent_action_required",
          payloadJson: JSON.stringify({ runId, traceId, reason: buResult.error ?? "execution_timeout", taskId: buResult.taskId ?? null, handoffUrl }),
          createdAt: doneTs,
        });
        return { runId, status: "action_required", reason: buResult.error ?? "execution_timeout", taskId: buResult.taskId ?? null, traceId, handoffUrl };
      }

      await ctx.runMutation(payments._updateRun, {
        runId,
        status: "failed",
        outputJson: buResult.raw ? JSON.stringify(buResult.raw) : null,
        error: buResult.error ?? "execution_failed",
        updatedAt: doneTs,
      });

      await ctx.runMutation(payments._setIntentStatus, {
        intentId: intent.intentId,
        status: "failed",
        updatedAt: doneTs,
      });

      await ctx.runMutation(payments._releaseHeldFundsForIntent, {
        userId: intent.userId,
        intentId: intent.intentId,
        amountCents: holdAmountCents,
        refType: "execution_failed",
        refId: runId,
      });

      await ctx.runMutation(payments._recordEvent, {
        intentId: intent.intentId,
        eventType: "intent_execution_failed",
        payloadJson: JSON.stringify({ runId, traceId, error: buResult.error, taskId: buResult.taskId ?? null, handoffUrl }),
        createdAt: doneTs,
      });

      await emitExternalTrace({
        traceId,
        runId,
        intentId: intent.intentId,
        phase: "failed",
        status: "failed",
        rail: resolvedRail,
        budgetUsd: intent.budgetUsd,
        task: intent.task,
        taskId: buResult.taskId ?? null,
        error: buResult.error ?? null,
        startedAt: ts,
        endedAt: doneTs,
      });

      return { runId, status: "failed", error: buResult.error, taskId: buResult.taskId ?? null, traceId, handoffUrl };
    }

    const handoffNeeded = outputSuggestsManualIntervention(buResult.output);
    const handoffUrl = buildBrowserUseHandoffUrl(buResult.taskId);

    await ctx.runMutation(payments._updateRun, {
      runId,
      status: handoffNeeded ? "action_required" : "ok",
      outputJson: JSON.stringify({
        taskId: buResult.taskId ?? null,
        output: buResult.output ?? null,
        raw: buResult.raw ?? null,
        handoffUrl,
      }),
      error: null,
      updatedAt: doneTs,
    });

    await ctx.runMutation(payments._settleHeldFundsForIntent, {
      userId: intent.userId,
      intentId: intent.intentId,
      amountCents: holdAmountCents,
      refType: "execution_ok",
      refId: runId,
    });

    await ctx.runMutation(payments._setIntentStatus, {
      intentId: intent.intentId,
      status: handoffNeeded ? "action_required" : "confirmed",
      updatedAt: doneTs,
    });

    await ctx.runMutation(payments._recordEvent, {
      intentId: intent.intentId,
      eventType: "intent_execution_confirmed",
      payloadJson: JSON.stringify({ runId, traceId, taskId: buResult.taskId ?? null, handoffNeeded, handoffUrl }),
      createdAt: doneTs,
    });

    await emitExternalTrace({
      traceId,
      runId,
      intentId: intent.intentId,
      phase: "confirmed",
      status: "ok",
      rail: resolvedRail,
      budgetUsd: intent.budgetUsd,
      task: intent.task,
      taskId: buResult.taskId ?? null,
      startedAt: ts,
      endedAt: doneTs,
    });

    if (intent.intentType === "api_key_purchase") {
      let credential: { type: string; provider: string; secretRef: string } | null = null;
      if (!handoffNeeded) {
        const extracted = extractLikelyApiKey(buResult.output);
        const secretRef = randomId("sec");
        await ctx.runMutation(payments._putSecret, {
          secretRef,
          userId: intent.userId,
          intentId: intent.intentId,
          provider: intent.provider ?? undefined,
          secretType: "api_key",
          secretValue: extracted ?? "PENDING_CAPTURE",
        });
        credential = {
          type: "api_key",
          provider: intent.provider ?? "unknown",
          secretRef,
        };
      }
      return {
        runId,
        status: handoffNeeded ? "action_required" : "ok",
        taskId: buResult.taskId ?? null,
        output: buResult.output ?? null,
        traceId,
        handoffUrl,
        credential,
      };
    }

    return {
      runId,
      status: handoffNeeded ? "action_required" : "ok",
      taskId: buResult.taskId ?? null,
      output: buResult.output ?? null,
      traceId,
      handoffUrl,
    };
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

export const _creditUserFunds = internalMutation({
  args: { userId: v.id("users"), amountCents: v.number(), refType: v.optional(v.string()), refId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.amountCents <= 0) throw new Error("amountCents must be > 0");
    const ts = now();
    let account = await ctx.db.query("agentAccounts").withIndex("by_user_id", (q) => q.eq("userId", args.userId)).unique();
    if (account === null) {
      const id = await ctx.db.insert("agentAccounts", { userId: args.userId, currency: "USD", availableCents: 0, heldCents: 0, status: "active", createdAt: ts, updatedAt: ts });
      account = await ctx.db.get(id);
    }
    if (account === null) throw new Error("account_create_failed");
    const available = account.availableCents + args.amountCents;
    await ctx.db.patch(account._id, { availableCents: available, updatedAt: ts });
    await ctx.db.insert("ledgerEntries", { entryId: randomId("le"), userId: args.userId, type: "deposit", amountCents: args.amountCents, balanceAfterAvailableCents: available, balanceAfterHeldCents: account.heldCents, refType: args.refType, refId: args.refId, createdAt: ts });
    return { ok: true, availableCents: available, heldCents: account.heldCents };
  },
});

export const _getAccount = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.query("agentAccounts").withIndex("by_user_id", (q) => q.eq("userId", args.userId)).unique();
  },
});

export const _holdFundsForIntent = internalMutation({
  args: { userId: v.id("users"), intentId: v.string(), amountCents: v.number() },
  handler: async (ctx, args) => {
    const ts = now();
    const account = await ctx.db.query("agentAccounts").withIndex("by_user_id", (q) => q.eq("userId", args.userId)).unique();
    if (account === null) return { ok: false, reason: "no_account", availableCents: 0 };
    if (account.availableCents < args.amountCents) return { ok: false, reason: "insufficient_funds", availableCents: account.availableCents };
    const available = account.availableCents - args.amountCents;
    const held = account.heldCents + args.amountCents;
    await ctx.db.patch(account._id, { availableCents: available, heldCents: held, updatedAt: ts });
    await ctx.db.insert("ledgerEntries", { entryId: randomId("le"), userId: args.userId, intentId: args.intentId, type: "hold", amountCents: -args.amountCents, balanceAfterAvailableCents: available, balanceAfterHeldCents: held, refType: "intent", refId: args.intentId, createdAt: ts });
    return { ok: true, availableCents: available, heldCents: held };
  },
});

export const _releaseHeldFundsForIntent = internalMutation({
  args: { userId: v.id("users"), intentId: v.string(), amountCents: v.number(), refType: v.optional(v.string()), refId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ts = now();
    const account = await ctx.db.query("agentAccounts").withIndex("by_user_id", (q) => q.eq("userId", args.userId)).unique();
    if (account === null) throw new Error("account_not_found");
    const amt = Math.min(args.amountCents, account.heldCents);
    const available = account.availableCents + amt;
    const held = account.heldCents - amt;
    await ctx.db.patch(account._id, { availableCents: available, heldCents: held, updatedAt: ts });
    await ctx.db.insert("ledgerEntries", { entryId: randomId("le"), userId: args.userId, intentId: args.intentId, type: "hold_release", amountCents: amt, balanceAfterAvailableCents: available, balanceAfterHeldCents: held, refType: args.refType, refId: args.refId, createdAt: ts });
    return { ok: true, availableCents: available, heldCents: held };
  },
});

export const _settleHeldFundsForIntent = internalMutation({
  args: { userId: v.id("users"), intentId: v.string(), amountCents: v.number(), refType: v.optional(v.string()), refId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ts = now();
    const account = await ctx.db.query("agentAccounts").withIndex("by_user_id", (q) => q.eq("userId", args.userId)).unique();
    if (account === null) throw new Error("account_not_found");
    const amt = Math.min(args.amountCents, account.heldCents);
    const held = account.heldCents - amt;
    await ctx.db.patch(account._id, { heldCents: held, updatedAt: ts });
    await ctx.db.insert("ledgerEntries", { entryId: randomId("le"), userId: args.userId, intentId: args.intentId, type: "debit_settlement", amountCents: -amt, balanceAfterAvailableCents: account.availableCents, balanceAfterHeldCents: held, refType: args.refType, refId: args.refId, createdAt: ts });
    return { ok: true, availableCents: account.availableCents, heldCents: held };
  },
});

export const _putSecret = internalMutation({
  args: {
    secretRef: v.string(),
    userId: v.id("users"),
    intentId: v.optional(v.string()),
    provider: v.optional(v.string()),
    secretType: v.string(),
    secretValue: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("agentSecrets", {
      secretRef: args.secretRef,
      userId: args.userId,
      intentId: args.intentId,
      provider: args.provider,
      secretType: args.secretType,
      secretValue: args.secretValue,
      createdAt: now(),
    });
    return { ok: true, secretRef: args.secretRef };
  },
});

export const _getSecretForUser = internalQuery({
  args: { userId: v.id("users"), secretRef: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("agentSecrets")
      .withIndex("by_secret_ref", (q) => q.eq("secretRef", args.secretRef))
      .unique();
    if (row === null || row.userId !== args.userId) return null;
    return row;
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
