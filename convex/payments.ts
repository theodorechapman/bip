import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  findPhase1Offering,
  normalizeLower,
  PHASE1_OFFERINGS,
  PHASE1_POLICY_DEFAULTS,
} from "./offerings";

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

function utcDayStartTs(ts: number): number {
  const date = new Date(ts);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function getPaymentsMode(): "free" | "metered" {
  const mode = (process.env.PAYMENTS_MODE ?? "free").trim().toLowerCase();
  return mode === "metered" ? "metered" : "free";
}

function getMinBudgetUsd(): number {
  const raw = Number(process.env.MIN_INTENT_BUDGET_USD ?? "1");
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

function isSubsidyMode(): boolean {
  return (process.env.SUBSIDY_MODE ?? "true").trim().toLowerCase() !== "false";
}


function getSolAutoSpendCapUsd(): number {
  const raw = Number(process.env.SOL_AUTO_SPEND_CAP_USD ?? "10");
  return Number.isFinite(raw) && raw > 0 ? raw : 10;
}

function getSolRpcUrl(): string {
  return (process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com").trim();
}

function parseBitrefillInvoice(output: unknown): { address: string; amountSol: number } | null {
  if (typeof output !== "string") return null;
  const addr = output.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
  const amt = output.match(/([0-9]+(?:\.[0-9]+)?)\s*(SOL|solana)/i);
  if (!addr || !amt) return null;
  const amount = Number(amt[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { address: addr[0], amountSol: amount };
}

async function sendSolTransfer(params: { secretHex: string; toAddress: string; amountSol: number }): Promise<{ ok: boolean; txSig?: string; error?: string }> {
  try {
    const bytes = new Uint8Array((params.secretHex.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16)));
    const kp = Keypair.fromSecretKey(bytes);
    const conn = new Connection(getSolRpcUrl(), "confirmed");
    const to = new PublicKey(params.toAddress);
    const lamports = Math.round(params.amountSol * LAMPORTS_PER_SOL);
    const { blockhash } = await conn.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: kp.publicKey, recentBlockhash: blockhash }).add(
      SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: to, lamports }),
    );
    tx.sign(kp);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await conn.confirmTransaction(sig, "confirmed");
    return { ok: true, txSig: sig };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "sol_transfer_failed" };
  }
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

type TreasuryCardSecret = {
  label: string;
  pan: string;
  expMonth: string;
  expYear: string;
  cvv: string;
  nameOnCard: string;
  billingZip: string | null;
  last4: string;
  status: string;
};

type TreasuryCardResolved = TreasuryCardSecret & {
  cardRef: string;
};

function parseTreasuryCardSecret(value: string): TreasuryCardSecret | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const card = parsed as Record<string, unknown>;
  const pan = typeof card.pan === "string" ? card.pan.trim() : "";
  const cvv = typeof card.cvv === "string" ? card.cvv.trim() : "";
  const label = typeof card.label === "string" ? card.label.trim() : "";
  const expMonth = typeof card.expMonth === "string" ? card.expMonth.trim() : "";
  const expYear = typeof card.expYear === "string" ? card.expYear.trim() : "";
  const nameOnCard =
    typeof card.nameOnCard === "string" ? card.nameOnCard.trim() : "";
  if (!pan || !cvv || !label || !expMonth || !expYear || !nameOnCard) return null;
  const billingZip =
    typeof card.billingZip === "string" && card.billingZip.trim().length > 0
      ? card.billingZip.trim()
      : null;
  const last4 =
    typeof card.last4 === "string" && card.last4.length === 4
      ? card.last4
      : pan.slice(-4);
  const status =
    typeof card.status === "string" && card.status.trim().length > 0
      ? card.status.trim()
      : "active";
  return {
    label,
    pan,
    expMonth,
    expYear,
    cvv,
    nameOnCard,
    billingZip,
    last4,
    status,
  };
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactSensitiveValue(value: string, sensitiveTokens: Array<string>): string {
  let out = value;
  for (const token of sensitiveTokens) {
    if (!token) continue;
    out = out.replace(new RegExp(escapeRegExp(token), "g"), "[REDACTED]");
  }
  return out;
}

function redactSensitiveOutput(
  value: unknown,
  sensitiveTokens: Array<string>,
): unknown {
  if (typeof value === "string") {
    return redactSensitiveValue(value, sensitiveTokens);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveOutput(item, sensitiveTokens));
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactSensitiveOutput(val, sensitiveTokens);
    }
    return out;
  }
  return value;
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
      secretType: "solana_private_key_hex",
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

export const listTreasuryCards = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("agentSecrets")
      .withIndex("by_secret_type_and_created_at", (q) =>
        q.eq("secretType", "treasury_card"),
      )
      .order("desc")
      .collect();
    return rows
      .map((row) => {
        const card = parseTreasuryCardSecret(row.secretValue);
        if (card === null) return null;
        return {
          cardRef: row.secretRef,
          label: card.label,
          last4: card.last4,
          exp: `${card.expMonth}/${card.expYear}`,
          status: card.status,
          createdAt: row.createdAt,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
  },
});

export const getTreasuryCardByRef = internalQuery({
  args: {
    cardRef: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("agentSecrets")
      .withIndex("by_secret_ref", (q) => q.eq("secretRef", args.cardRef))
      .unique();
    if (row === null || row.secretType !== "treasury_card") return null;
    const card = parseTreasuryCardSecret(row.secretValue);
    if (card === null) return null;
    return {
      cardRef: row.secretRef,
      ...card,
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

export const executeIntent = internalAction({
  args: { intentId: v.string(), apiKey: v.optional(v.string()) },
  handler: async (ctx, args): Promise<any> => {
    const payments: any = (internal as any).payments;
    const intent = await ctx.runQuery(payments.getIntent, { intentId: args.intentId });
    if (intent === null) throw new Error("Intent not found");
    if (intent.status !== "approved") throw new Error("Intent is not approved");

    await ctx.runMutation(payments._ensureAccount, { userId: intent.userId });

    const paymentsMode = getPaymentsMode();
    const minBudget = getMinBudgetUsd();
    const subsidyMode = isSubsidyMode();
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

    const holdAmountCents = subsidyMode ? 0 : Math.max(1, Math.round(intent.budgetUsd * 100));
    const holdResult = holdAmountCents > 0
      ? await ctx.runMutation(payments._holdFundsForIntent, {
          userId: intent.userId,
          intentId: intent.intentId,
          amountCents: holdAmountCents,
        })
      : ({ ok: true, availableCents: -1, heldCents: -1 } as const);
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

    let treasuryPaymentArtifact:
      | {
          paymentSource: "treasury_card_ref";
          cardRef: string;
        }
      | null = null;
    let treasuryCard: TreasuryCardResolved | null = null;
    let sensitiveTokens: Array<string> = [];
    let meta: any = null;
    try {
      meta = intent.metadataJson ? JSON.parse(intent.metadataJson) : null;
    } catch {
      meta = null;
    }
    if (intent.intentType === "giftcard_purchase") {
      const cardRef =
        typeof meta?.cardRef === "string" && meta.cardRef.trim().length > 0
          ? meta.cardRef.trim()
          : null;
      if (cardRef !== null) {
        treasuryCard = await ctx.runQuery(payments.getTreasuryCardByRef, { cardRef });
        if (treasuryCard !== null) {
          treasuryPaymentArtifact = {
            paymentSource: "treasury_card_ref",
            cardRef: treasuryCard.cardRef,
          };
          sensitiveTokens = [treasuryCard.pan, treasuryCard.cvv];
        }
      }
    }

    // Real bitrefill adapter path (if selected)
    if (resolvedRail === "bitrefill") {
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
      if (holdAmountCents > 0) {
        await ctx.runMutation(payments._settleHeldFundsForIntent, {
          userId: intent.userId,
          intentId: intent.intentId,
          amountCents: holdAmountCents,
          refType: "bitrefill_order",
          refId: br.orderId ?? runId,
        });
      }
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

    const treasuryCardInstructions =
      treasuryCard === null
        ? ""
        : `\nUse treasury payment instrument details for checkout:\nCard number: ${treasuryCard.pan}\nExpiry month: ${treasuryCard.expMonth}\nExpiry year: ${treasuryCard.expYear}\nCVV: ${treasuryCard.cvv}\nName on card: ${treasuryCard.nameOnCard}${
            treasuryCard.billingZip !== null
              ? `\nBilling ZIP: ${treasuryCard.billingZip}`
              : ""
          }`;
    const buTask = `[rail=${resolvedRail}] ${intent.task}${
      treasuryPaymentArtifact !== null
        ? `\n[payment_source=${treasuryPaymentArtifact.paymentSource}] [card_ref=${treasuryPaymentArtifact.cardRef}]${treasuryCardInstructions}`
        : ""
    }`;
    const buResult = await callBrowserUseTask(buTask, args.apiKey);
    const doneTs = now();

    if (!buResult.ok) {
      const sanitizedRaw =
        buResult.raw === undefined
          ? null
          : redactSensitiveOutput(buResult.raw, sensitiveTokens);
      const sanitizedError =
        buResult.error === undefined || buResult.error === null
          ? buResult.error
          : `${redactSensitiveOutput(buResult.error, sensitiveTokens)}`;
      const handoffUrl = buildBrowserUseHandoffUrl(buResult.taskId);
      const isRecoverable = (intent.intentType === "account_bootstrap" || intent.intentType === "api_key_purchase") && (buResult.error ?? "").toLowerCase().includes("timeout");
      if (isRecoverable) {
        await ctx.runMutation(payments._updateRun, {
          runId,
          status: "action_required",
          outputJson: JSON.stringify({
            taskId: buResult.taskId ?? null,
            handoffUrl,
            raw: sanitizedRaw,
            ...(treasuryPaymentArtifact ?? {}),
          }),
          error: sanitizedError ?? "execution_timeout",
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
          payloadJson: JSON.stringify({
            runId,
            traceId,
            reason: sanitizedError ?? "execution_timeout",
            taskId: buResult.taskId ?? null,
            handoffUrl,
          }),
          createdAt: doneTs,
        });
        return {
          runId,
          status: "action_required",
          reason: sanitizedError ?? "execution_timeout",
          taskId: buResult.taskId ?? null,
          traceId,
          handoffUrl,
          ...(treasuryPaymentArtifact ?? {}),
        };
      }

      await ctx.runMutation(payments._updateRun, {
        runId,
        status: "failed",
        outputJson:
          sanitizedRaw === null
            ? (treasuryPaymentArtifact === null
              ? null
              : JSON.stringify({ ...treasuryPaymentArtifact }))
            : JSON.stringify({
                raw: sanitizedRaw,
                ...(treasuryPaymentArtifact ?? {}),
              }),
        error: sanitizedError ?? "execution_failed",
        updatedAt: doneTs,
      });

      await ctx.runMutation(payments._setIntentStatus, {
        intentId: intent.intentId,
        status: "failed",
        updatedAt: doneTs,
      });

      if (holdAmountCents > 0) {
        await ctx.runMutation(payments._releaseHeldFundsForIntent, {
          userId: intent.userId,
          intentId: intent.intentId,
          amountCents: holdAmountCents,
          refType: "execution_failed",
          refId: runId,
        });
      }

      await ctx.runMutation(payments._recordEvent, {
        intentId: intent.intentId,
        eventType: "intent_execution_failed",
        payloadJson: JSON.stringify({
          runId,
          traceId,
          error: sanitizedError,
          taskId: buResult.taskId ?? null,
          handoffUrl,
        }),
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
        error: sanitizedError ?? null,
        startedAt: ts,
        endedAt: doneTs,
      });

      return {
        runId,
        status: "failed",
        error: sanitizedError,
        taskId: buResult.taskId ?? null,
        traceId,
        handoffUrl,
        ...(treasuryPaymentArtifact ?? {}),
      };
    }

    if (intent.intentType === "bitrefill_crypto_checkout") {
      let invoice = parseBitrefillInvoice(buResult.output);
      if (invoice === null && typeof buResult.output === "string") {
        const addr2 = buResult.output.match(/address is\s+([1-9A-HJ-NP-Za-km-z]{32,44})/i);
        const amt2 = buResult.output.match(/amount[^0-9]*([0-9]+(?:\.[0-9]+)?)\s*SOL/i);
        if (addr2 && amt2) invoice = { address: addr2[1], amountSol: Number(amt2[1]) };
      }
      if (invoice === null) {
        return {
          runId,
          status: "action_required",
          taskId: buResult.taskId ?? null,
          traceId,
          handoffUrl: buildBrowserUseHandoffUrl(buResult.taskId),
          reason: "invoice_not_detected",
          output: buResult.output ?? null,
        };
      }
      const capUsd = getSolAutoSpendCapUsd();
      if (invoice.amountSol > capUsd) {
        return {
          runId,
          status: "action_required",
          taskId: buResult.taskId ?? null,
          traceId,
          handoffUrl: buildBrowserUseHandoffUrl(buResult.taskId),
          reason: "amount_above_cap",
          invoice,
          capUsd,
        };
      }
      const secret = await ctx.runQuery(payments._getLatestWalletSecret, { userId: intent.userId });
      if (secret === null) {
        return {
          runId,
          status: "action_required",
          taskId: buResult.taskId ?? null,
          traceId,
          handoffUrl: buildBrowserUseHandoffUrl(buResult.taskId),
          reason: "wallet_secret_missing",
          invoice,
        };
      }
      const transfer = await sendSolTransfer({
        secretHex: secret.secretValue,
        toAddress: invoice.address,
        amountSol: invoice.amountSol,
      });
      if (!transfer.ok) {
        return {
          runId,
          status: "failed",
          taskId: buResult.taskId ?? null,
          traceId,
          reason: transfer.error ?? "sol_transfer_failed",
          invoice,
        };
      }
      return {
        runId,
        status: "ok",
        taskId: buResult.taskId ?? null,
        traceId,
        invoice,
        txSig: transfer.txSig,
        output: buResult.output ?? null,
      };
    }

    const handoffNeeded = outputSuggestsManualIntervention(buResult.output);
    const handoffUrl = buildBrowserUseHandoffUrl(buResult.taskId);
    const sanitizedOutput = redactSensitiveOutput(buResult.output, sensitiveTokens);
    const sanitizedRaw = redactSensitiveOutput(buResult.raw, sensitiveTokens);

    await ctx.runMutation(payments._updateRun, {
      runId,
      status: handoffNeeded ? "action_required" : "ok",
      outputJson: JSON.stringify({
        taskId: buResult.taskId ?? null,
        output: sanitizedOutput ?? null,
        raw: sanitizedRaw ?? null,
        handoffUrl,
        ...(treasuryPaymentArtifact ?? {}),
      }),
      error: null,
      updatedAt: doneTs,
    });

    if (holdAmountCents > 0) {
      await ctx.runMutation(payments._settleHeldFundsForIntent, {
        userId: intent.userId,
        intentId: intent.intentId,
        amountCents: holdAmountCents,
        refType: "execution_ok",
        refId: runId,
      });
    }

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
        output: sanitizedOutput ?? null,
        traceId,
        handoffUrl,
        credential,
        ...(treasuryPaymentArtifact ?? {}),
      };
    }

    return {
      runId,
      status: handoffNeeded ? "action_required" : "ok",
      taskId: buResult.taskId ?? null,
      output: sanitizedOutput ?? null,
      traceId,
      handoffUrl,
      ...(treasuryPaymentArtifact ?? {}),
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

export const _ensureAccount = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const ts = now();
    let account = await ctx.db.query("agentAccounts").withIndex("by_user_id", (q) => q.eq("userId", args.userId)).unique();
    if (account === null) {
      const id = await ctx.db.insert("agentAccounts", {
        userId: args.userId,
        currency: "USD",
        availableCents: 0,
        heldCents: 0,
        status: "active",
        createdAt: ts,
        updatedAt: ts,
      });
      account = await ctx.db.get(id);
    }
    if (account === null) throw new Error("account_create_failed");
    return { ok: true, account };
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
    if (account === null) return { ok: true, availableCents: 0, heldCents: 0 };
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
    if (account === null) return { ok: true, availableCents: 0, heldCents: 0 };
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

export const _getLatestWalletSecret = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("agentSecrets")
      .withIndex("by_user_id_and_created_at", (qq) => qq.eq("userId", args.userId))
      .order("desc")
      .take(20);
    const secret = rows.find((r: any) => r.secretType === "solana_private_key_hex");
    return secret ?? null;
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


export const transferSolBetweenWallets = internalAction({
  args: {
    userId: v.id("users"),
    fromAddress: v.string(),
    toAddress: v.string(),
    amountSol: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.amountSol <= 0) throw new Error("amountSol must be > 0");
    const cap = getSolAutoSpendCapUsd();
    if (args.amountSol > cap) throw new Error("amount_above_cap");

    const walletRows = await ctx.runQuery(internal.payments.getWalletByAddressForUser, {
      userId: args.userId,
      address: args.fromAddress,
    });
    if (walletRows === null) throw new Error("from_wallet_not_found");

    const secret = await ctx.runQuery(internal.payments.getWalletSecretByAddressForUser, {
      userId: args.userId,
      address: args.fromAddress,
    });
    if (secret === null) throw new Error("from_wallet_secret_not_found");

    const sent = await sendSolTransfer({
      secretHex: secret.secretValue,
      toAddress: args.toAddress,
      amountSol: args.amountSol,
    });
    if (!sent.ok) throw new Error(sent.error ?? "sol_transfer_failed");
    return { ok: true, txSig: sent.txSig, fromAddress: args.fromAddress, toAddress: args.toAddress, amountSol: args.amountSol };
  },
});


export const getWalletByAddressForUser = internalQuery({
  args: { userId: v.id("users"), address: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("agentWallets")
      .withIndex("by_user_id_and_created_at", (q) => q.eq("userId", args.userId))
      .collect();
    return rows.find((r) => r.address === args.address) ?? null;
  },
});

export const getWalletSecretByAddressForUser = internalQuery({
  args: { userId: v.id("users"), address: v.string() },
  handler: async (ctx, args) => {
    const wallet = await ctx.db
      .query("agentWallets")
      .withIndex("by_user_id_and_created_at", (q) => q.eq("userId", args.userId))
      .collect();
    const exists = wallet.some((w) => w.address === args.address);
    if (!exists) return null;
    const secrets = await ctx.db
      .query("agentSecrets")
      .withIndex("by_user_id_and_created_at", (q) => q.eq("userId", args.userId))
      .order("desc")
      .collect();
    return secrets.find((s) => s.secretType === "solana_private_key_hex") ?? null;
  },
});
