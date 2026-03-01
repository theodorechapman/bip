import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import {
  randomId,
  now,
  getPaymentsMode,
  getMinBudgetUsd,
  isSubsidyMode,
  getSolAutoSpendCapUsd,
} from "./lib/paymentsUtils";
import { parseBitrefillInvoice, sendSolTransfer } from "./lib/solana";
import {
  callBrowserUseTask,
  callBrowserUseSkill,
  tryVerifyViaFetch,
  buildBrowserUseHandoffUrl,
  callBitrefillPurchase,
} from "./lib/browserUse";
import {
  parseGiftcardExecutionMetadata,
  parseApiKeyPurchaseMetadata,
  parseXAccountBootstrapMetadata,
  parseXPostMetadata,
  getApiKeyProviderDomain,
  buildApiKeyPurchaseTask,
  buildApiKeyResumeTask,
  buildApiKeyDryRunPlan,
  buildXAccountBootstrapTask,
  buildXPostTask,
  outputSuggestsManualIntervention,
  extractLikelyApiKey,
  bestEffortValidateApiKey,
} from "./lib/taskBuilders";
import type { TreasuryCardResolved } from "./lib/treasuryCard";
import { redactSensitiveOutput } from "./lib/treasuryCard";
import { emitTrace } from "./observability";

// Internal refs to other convex modules
const intentsRef = () => (internal as any).intents;
const accountsRef = () => (internal as any).accounts;
const secretsRef = () => (internal as any).secrets;
const treasuryRef = () => (internal as any).treasury;
const executorRef = () => (internal as any).executor;

export const scheduleExecution = internalMutation({
  args: { intentId: v.string(), apiKey: v.optional(v.string()), sessionId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const intent = await ctx.db
      .query("paymentIntents")
      .withIndex("by_intent_id", (q) => q.eq("intentId", args.intentId))
      .unique();
    if (intent === null) throw new Error("Intent not found");
    if (intent.status !== "approved") throw new Error("Intent is not approved");
    await ctx.scheduler.runAfter(0, executorRef().executeIntent, {
      intentId: args.intentId,
      apiKey: args.apiKey,
      sessionId: args.sessionId,
    });
    return { ok: true, intentId: args.intentId, status: "executing" };
  },
});

export const scheduleResume = internalMutation({
  args: { intentId: v.string(), apiKey: v.optional(v.string()), sessionId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const intent = await ctx.db
      .query("paymentIntents")
      .withIndex("by_intent_id", (q) => q.eq("intentId", args.intentId))
      .unique();
    if (intent === null) throw new Error("Intent not found");
    if (intent.status !== "action_required") throw new Error("Intent is not in action_required status");
    // Reset to approved so executeIntent can pick it up
    await ctx.db.patch(intent._id, { status: "approved", updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, executorRef().executeIntent, {
      intentId: args.intentId,
      apiKey: args.apiKey,
      sessionId: args.sessionId,
    });
    return { ok: true, intentId: args.intentId, status: "resuming" };
  },
});

export const executeIntent = internalAction({
  args: { intentId: v.string(), apiKey: v.optional(v.string()), sessionId: v.optional(v.string()) },
  handler: async (ctx, args): Promise<any> => {
    const intent = await ctx.runQuery(intentsRef().getIntent, { intentId: args.intentId });
    if (intent === null) throw new Error("Intent not found");
    if (intent.status !== "approved") throw new Error("Intent is not approved");

    await ctx.runMutation(accountsRef()._ensureAccount, { userId: intent.userId });

    const paymentsMode = getPaymentsMode();
    const minBudget = getMinBudgetUsd();
    const subsidyMode = isSubsidyMode();
    if (paymentsMode === "metered" && intent.budgetUsd < minBudget) {
      const blockedAt = now();
      await ctx.runMutation(secretsRef()._recordEvent, {
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
      await ctx.runMutation(intentsRef()._setIntentStatus, {
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
      ? await ctx.runMutation(accountsRef()._holdFundsForIntent, {
          userId: intent.userId,
          intentId: intent.intentId,
          amountCents: holdAmountCents,
        })
      : ({ ok: true, availableCents: -1, heldCents: -1 } as const);
    if (!holdResult.ok) {
      const blockedAt = now();
      await ctx.runMutation(secretsRef()._recordEvent, {
        intentId: intent.intentId,
        eventType: "payment_required",
        payloadJson: JSON.stringify({
          reason: "insufficient_funds",
          requiredCents: holdAmountCents,
          availableCents: holdResult.availableCents,
        }),
        createdAt: blockedAt,
      });
      await ctx.runMutation(intentsRef()._setIntentStatus, {
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

    await ctx.runMutation(intentsRef()._insertRun, {
      runId,
      intentId: intent.intentId,
      userId: intent.userId,
      status: "running",
      outputJson: null,
      error: null,
      createdAt: ts,
      updatedAt: ts,
    });

    await ctx.runMutation(intentsRef()._setIntentSubmitted, {
      intentId: intent.intentId,
      runId,
      updatedAt: ts,
    });

    const resolvedRail = intent.rail === "auto" ? "x402" : intent.rail;

    await ctx.runMutation(secretsRef()._recordEvent, {
      intentId: intent.intentId,
      eventType: "intent_execution_started",
      payloadJson: JSON.stringify({ runId, traceId, rail: resolvedRail }),
      createdAt: ts,
    });

    await emitTrace({
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
      await ctx.runMutation(intentsRef()._updateRun, {
        runId,
        status: "failed",
        outputJson: null,
        error: `unsupported_rail:${resolvedRail}`,
        updatedAt: ts,
      });
      await ctx.runMutation(intentsRef()._setIntentStatus, {
        intentId: intent.intentId,
        status: "failed",
        updatedAt: ts,
      });
      await ctx.runMutation(secretsRef()._recordEvent, {
        intentId: intent.intentId,
        eventType: "intent_execution_failed",
        payloadJson: JSON.stringify({ runId, error: `unsupported_rail:${resolvedRail}` }),
        createdAt: ts,
      });
      return { runId, status: "failed", error: `unsupported_rail:${resolvedRail}` };
    }

    await ctx.runMutation(secretsRef()._recordEvent, {
      intentId: intent.intentId,
      eventType: "rail_selected",
      payloadJson: JSON.stringify({ runId, traceId, rail: resolvedRail, mode: paymentsMode }),
      createdAt: ts,
    });

    await emitTrace({
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

    // ── Shopify intents: direct API execution (no browser-use) ──
    if (intent.intentType?.startsWith("shopify_")) {
      try {
        const { executeShopifyIntent } = await import("./shopifyExecutor");
        const shopifyResult = await executeShopifyIntent(ctx, intent, meta, runId, traceId);
        const doneTs = now();

        if (shopifyResult.ok) {
          await ctx.runMutation(intentsRef()._updateRun, {
            runId,
            status: "ok",
            outputJson: JSON.stringify(shopifyResult.data ?? {}),
            error: null,
            updatedAt: doneTs,
          });
          if (holdAmountCents > 0) {
            await ctx.runMutation(accountsRef()._settleHeldFundsForIntent, {
              userId: intent.userId,
              intentId: intent.intentId,
              amountCents: holdAmountCents,
              refType: "shopify_execution",
              refId: runId,
            });
          }
          await ctx.runMutation(intentsRef()._setIntentStatus, {
            intentId: intent.intentId,
            status: "confirmed",
            updatedAt: doneTs,
          });
          await ctx.runMutation(secretsRef()._recordEvent, {
            intentId: intent.intentId,
            eventType: "intent_execution_confirmed",
            payloadJson: JSON.stringify({ runId, traceId, rail: "shopify_direct", ...shopifyResult.data }),
            createdAt: doneTs,
          });
          return { runId, status: "ok", traceId, ...shopifyResult.data };
        } else {
          await ctx.runMutation(intentsRef()._updateRun, {
            runId,
            status: "failed",
            outputJson: shopifyResult.data ? JSON.stringify(shopifyResult.data) : null,
            error: shopifyResult.error ?? "shopify_execution_failed",
            updatedAt: doneTs,
          });
          if (holdAmountCents > 0) {
            await ctx.runMutation(accountsRef()._releaseHeldFundsForIntent, {
              userId: intent.userId,
              intentId: intent.intentId,
              amountCents: holdAmountCents,
              refType: "execution_failed",
              refId: runId,
            });
          }
          await ctx.runMutation(intentsRef()._setIntentStatus, {
            intentId: intent.intentId,
            status: "failed",
            updatedAt: doneTs,
          });
          await ctx.runMutation(secretsRef()._recordEvent, {
            intentId: intent.intentId,
            eventType: "intent_execution_failed",
            payloadJson: JSON.stringify({ runId, error: shopifyResult.error }),
            createdAt: doneTs,
          });
          return { runId, status: "failed", error: shopifyResult.error, traceId };
        }
      } catch (e: any) {
        const doneTs = now();
        const errorMsg = e?.message ?? "shopify_execution_error";
        await ctx.runMutation(intentsRef()._updateRun, {
          runId,
          status: "failed",
          outputJson: null,
          error: errorMsg,
          updatedAt: doneTs,
        });
        if (holdAmountCents > 0) {
          await ctx.runMutation(accountsRef()._releaseHeldFundsForIntent, {
            userId: intent.userId,
            intentId: intent.intentId,
            amountCents: holdAmountCents,
            refType: "execution_failed",
            refId: runId,
          });
        }
        await ctx.runMutation(intentsRef()._setIntentStatus, {
          intentId: intent.intentId,
          status: "failed",
          updatedAt: doneTs,
        });
        return { runId, status: "failed", error: errorMsg, traceId };
      }
    }

    const apiKeyMeta =
      intent.intentType === "api_key_purchase" ? parseApiKeyPurchaseMetadata(meta) : null;
    const xBootstrapMeta =
      intent.intentType === "x_account_bootstrap" ? parseXAccountBootstrapMetadata(meta) : null;
    const xPostMeta =
      intent.intentType === "x_post" ? parseXPostMetadata(meta) : null;
    if (intent.intentType === "giftcard_purchase") {
      const cardRef =
        typeof meta?.cardRef === "string" && meta.cardRef.trim().length > 0
          ? meta.cardRef.trim()
          : null;
      if (cardRef !== null) {
        treasuryCard = await ctx.runQuery(treasuryRef().getTreasuryCardByRef, { cardRef });
        if (treasuryCard !== null) {
          treasuryPaymentArtifact = {
            paymentSource: "treasury_card_ref",
            cardRef: treasuryCard.cardRef,
          };
          sensitiveTokens = [treasuryCard.pan, treasuryCard.cvv];
        }
      }
    }
    if (intent.intentType === "api_key_purchase" && apiKeyMeta === null) {
      const doneTs = now();
      await ctx.runMutation(intentsRef()._updateRun, {
        runId,
        status: "failed",
        outputJson: null,
        error: "invalid_api_key_purchase_metadata",
        updatedAt: doneTs,
      });
      if (holdAmountCents > 0) {
        await ctx.runMutation(accountsRef()._releaseHeldFundsForIntent, {
          userId: intent.userId,
          intentId: intent.intentId,
          amountCents: holdAmountCents,
          refType: "execution_failed",
          refId: runId,
        });
      }
      await ctx.runMutation(intentsRef()._setIntentStatus, {
        intentId: intent.intentId,
        status: "failed",
        updatedAt: doneTs,
      });
      return {
        runId,
        status: "failed",
        error: "invalid_api_key_purchase_metadata",
        traceId,
      };
    }

    if (intent.intentType === "api_key_purchase" && apiKeyMeta?.dryRun === true) {
      const doneTs = now();
      const provider = intent.provider ?? apiKeyMeta.provider;
      const providerDomain = getApiKeyProviderDomain(provider);
      const nextAction = "Run execute_intent again with metadata.dryRun=false to perform real purchase.";
      const reason = providerDomain === null ? "provider_domain_not_supported" : "dry_run_plan_only";
      const plan =
        providerDomain === null
          ? `No deterministic domain mapping for provider=${provider}.`
          : buildApiKeyDryRunPlan({
              provider,
              providerDomain,
              accountEmailMode: apiKeyMeta.accountEmailMode,
              targetProduct: apiKeyMeta.targetProduct,
            });

      await ctx.runMutation(intentsRef()._updateRun, {
        runId,
        status: "action_required",
        outputJson: JSON.stringify({
          provider,
          plan,
          reason,
        }),
        error: null,
        updatedAt: doneTs,
      });
      if (holdAmountCents > 0) {
        await ctx.runMutation(accountsRef()._releaseHeldFundsForIntent, {
          userId: intent.userId,
          intentId: intent.intentId,
          amountCents: holdAmountCents,
          refType: "dry_run_release",
          refId: runId,
        });
      }
      await ctx.runMutation(intentsRef()._setIntentStatus, {
        intentId: intent.intentId,
        status: "action_required",
        updatedAt: doneTs,
      });
      await ctx.runMutation(secretsRef()._recordEvent, {
        intentId: intent.intentId,
        eventType: "intent_action_required",
        payloadJson: JSON.stringify({ runId, traceId, reason, nextAction }),
        createdAt: doneTs,
      });
      return {
        runId,
        status: "action_required",
        provider,
        traceId,
        reason,
        nextAction,
        handoffUrl: null,
        output: plan,
      };
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
        await ctx.runMutation(intentsRef()._updateRun, {
          runId,
          status: "failed",
          outputJson: br.raw ? JSON.stringify(br.raw) : null,
          error: br.error ?? "bitrefill_failed",
          updatedAt: doneTs,
        });
        await ctx.runMutation(accountsRef()._releaseHeldFundsForIntent, {
          userId: intent.userId,
          intentId: intent.intentId,
          amountCents: holdAmountCents,
          refType: "execution_failed",
          refId: runId,
        });
        await ctx.runMutation(intentsRef()._setIntentStatus, {
          intentId: intent.intentId,
          status: "failed",
          updatedAt: doneTs,
        });
        await ctx.runMutation(secretsRef()._recordEvent, {
          intentId: intent.intentId,
          eventType: "intent_execution_failed",
          payloadJson: JSON.stringify({ runId, error: br.error ?? "bitrefill_failed" }),
          createdAt: doneTs,
        });
        return { runId, status: "failed", error: br.error ?? "bitrefill_failed" };
      }

      await ctx.runMutation(intentsRef()._updateRun, {
        runId,
        status: "ok",
        outputJson: JSON.stringify({ rail: "bitrefill", orderId: br.orderId ?? null, code: br.code ?? null, raw: br.raw ?? null }),
        error: null,
        updatedAt: doneTs,
      });
      if (holdAmountCents > 0) {
        await ctx.runMutation(accountsRef()._settleHeldFundsForIntent, {
          userId: intent.userId,
          intentId: intent.intentId,
          amountCents: holdAmountCents,
          refType: "bitrefill_order",
          refId: br.orderId ?? runId,
        });
      }
      await ctx.runMutation(intentsRef()._setIntentStatus, {
        intentId: intent.intentId,
        status: "confirmed",
        updatedAt: doneTs,
      });
      await ctx.runMutation(secretsRef()._recordEvent, {
        intentId: intent.intentId,
        eventType: "intent_execution_confirmed",
        payloadJson: JSON.stringify({ runId, rail: "bitrefill", orderId: br.orderId ?? null }),
        createdAt: doneTs,
      });
      return { runId, status: "ok", rail: "bitrefill", orderId: br.orderId ?? null, code: br.code ?? null, traceId };
    }

    // ── Provision AgentMail identity for browser tasks ──
    let agentEmail: string | null = null;
    let agentPassword: string | null = null;
    let agentInboxId: string | null = null;
    const shouldProvisionEmail =
      apiKeyMeta?.accountEmailMode === "agentmail" ||
      intent.intentType === "account_bootstrap" ||
      intent.intentType === "x_account_bootstrap" ||
      intent.intentType === "giftcard_purchase";

    if (shouldProvisionEmail) {
      try {
        const emailPrefix = `bip-agent-${Date.now()}`;
        const inboxResult = await ctx.runAction(internal.agentmail.createAgentmailInbox, {
          userId: intent.userId,
          requestedEmail: emailPrefix,
        });
        agentEmail = typeof inboxResult.email === "string" ? inboxResult.email : null;
        agentInboxId = typeof inboxResult.inboxId === "string" ? inboxResult.inboxId : null;
      } catch (e: any) {
        console.warn("[executeIntent] inbox creation failed, trying existing:", e?.message);
        try {
          const existing = await ctx.runQuery(internal.agentmail.getActiveInbox, { userId: intent.userId });
          if (existing?.inboxId) {
            agentEmail = existing.requestedEmail
              ? `${existing.requestedEmail}@agentmail.to`
              : `${existing.inboxId}@agentmail.to`;
            agentInboxId = existing.inboxId;
            console.log("[executeIntent] reusing existing inbox:", agentInboxId);
          }
        } catch {
          console.error("[executeIntent] no existing inbox available either");
        }
        await ctx.runMutation(secretsRef()._recordEvent, {
          intentId: intent.intentId,
          eventType: "agentmail_provision_failed",
          payloadJson: JSON.stringify({
            runId,
            traceId,
            error: e?.message ?? "unknown",
            fallbackInboxId: agentInboxId,
          }),
          createdAt: now(),
        });
      }
      const pwBytes = new Uint8Array(16);
      crypto.getRandomValues(pwBytes);
      agentPassword = Array.from(pwBytes).map(b => b.toString(36)).join("").slice(0, 20) + "!A1";
    }

    if (agentEmail) sensitiveTokens.push(agentEmail);
    if (agentPassword) sensitiveTokens.push(agentPassword);

    const requiresInbox = intent.intentType === "x_account_bootstrap" || intent.intentType === "account_bootstrap";
    if (requiresInbox && (agentEmail === null || agentInboxId === null)) {
      const failTs = now();
      await ctx.runMutation(intentsRef()._updateRun, {
        runId,
        status: "failed",
        outputJson: null,
        error: "agentmail_inbox_required",
        updatedAt: failTs,
      });
      await ctx.runMutation(intentsRef()._setIntentStatus, {
        intentId: intent.intentId,
        status: "failed",
        updatedAt: failTs,
      });
      await ctx.runMutation(secretsRef()._recordEvent, {
        intentId: intent.intentId,
        eventType: "intent_execution_failed",
        payloadJson: JSON.stringify({
          runId,
          traceId,
          error: "Cannot provision AgentMail inbox — required for email verification. Check inbox limits or delete an existing inbox.",
        }),
        createdAt: failTs,
      });
      return {
        runId,
        status: "failed",
        error: "agentmail_inbox_required",
        detail: "Cannot provision AgentMail inbox for email verification. Delete an existing inbox or upgrade the AgentMail plan.",
        traceId,
      };
    }

    const agentCredentialInstructions =
      agentEmail !== null && agentPassword !== null
        ? `\nAccount credentials for signup:\nEmail: ${agentEmail}\nPassword: ${agentPassword}\nUse these credentials to create an account. Do NOT use Google/GitHub OAuth — use email signup.`
        : "";

    const treasuryCardInstructions =
      treasuryCard === null
        ? ""
        : `\nUse treasury payment instrument details for checkout:\nCard number: ${treasuryCard.pan}\nExpiry month: ${treasuryCard.expMonth}\nExpiry year: ${treasuryCard.expYear}\nCVV: ${treasuryCard.cvv}\nName on card: ${treasuryCard.nameOnCard}${
            treasuryCard.billingZip !== null
              ? `\nBilling ZIP: ${treasuryCard.billingZip}`
              : ""
          }`;
    let buTask = `[rail=${resolvedRail}] ${intent.task}${
      treasuryPaymentArtifact !== null
        ? `\n[payment_source=${treasuryPaymentArtifact.paymentSource}] [card_ref=${treasuryPaymentArtifact.cardRef}]${treasuryCardInstructions}`
        : ""
    }${agentCredentialInstructions}`;
    if (intent.intentType === "api_key_purchase" && apiKeyMeta !== null) {
      const provider = intent.provider ?? apiKeyMeta.provider;
      const providerDomain = getApiKeyProviderDomain(provider);
      if (providerDomain === null) {
        const doneTs = now();
        const reason = "provider_domain_not_supported";
        const nextAction = "Use provider=openrouter or provider=elevenlabs for deterministic api_key_purchase.";
        await ctx.runMutation(intentsRef()._updateRun, {
          runId,
          status: "action_required",
          outputJson: JSON.stringify({
            provider,
            reason,
          }),
          error: null,
          updatedAt: doneTs,
        });
        if (holdAmountCents > 0) {
          await ctx.runMutation(accountsRef()._releaseHeldFundsForIntent, {
            userId: intent.userId,
            intentId: intent.intentId,
            amountCents: holdAmountCents,
            refType: "execution_failed",
            refId: runId,
          });
        }
        await ctx.runMutation(intentsRef()._setIntentStatus, {
          intentId: intent.intentId,
          status: "action_required",
          updatedAt: doneTs,
        });
        await ctx.runMutation(secretsRef()._recordEvent, {
          intentId: intent.intentId,
          eventType: "intent_action_required",
          payloadJson: JSON.stringify({ runId, traceId, reason, nextAction }),
          createdAt: doneTs,
        });
        return {
          runId,
          status: "action_required",
          provider,
          traceId,
          reason,
          nextAction,
          handoffUrl: null,
        };
      }
      buTask = buildApiKeyPurchaseTask({
        provider,
        providerDomain,
        task: intent.task,
        accountEmailMode: apiKeyMeta.accountEmailMode,
        targetProduct: apiKeyMeta.targetProduct,
      });
      if (treasuryCardInstructions) buTask += treasuryCardInstructions;
      if (agentCredentialInstructions) buTask += agentCredentialInstructions;
    }

    // ── X Account Bootstrap: build structured task ──
    if (intent.intentType === "x_account_bootstrap" && xBootstrapMeta !== null) {
      buTask = buildXAccountBootstrapTask({
        profileName: xBootstrapMeta.profileName,
        handle: xBootstrapMeta.handle,
        bio: xBootstrapMeta.bio,
        agentCredentialInstructions,
      });
    }

    // ── X Post: build structured task ──
    if (intent.intentType === "x_post" && xPostMeta !== null) {
      buTask = buildXPostTask({
        postText: xPostMeta.postText,
        imageBase64: xPostMeta.imageBase64,
        agentCredentialInstructions,
      });
    }

    // Snapshot existing message IDs so we only look at NEW emails after signup
    let knownMessageIds: string[] = [];
    if (agentInboxId && shouldProvisionEmail) {
      try {
        knownMessageIds = await ctx.runAction(internal.agentmail.getExistingMessageIds, {
          inboxId: agentInboxId,
        });
      } catch (e: any) {
        console.error("[executeIntent] failed to snapshot message IDs:", e?.message);
      }
    }

    // ── Determine browser-use options for X intents ──
    const isXIntent = intent.intentType === "x_account_bootstrap" || intent.intentType === "x_post";
    const xAllowedDomains = isXIntent ? ["x.com", "twitter.com"] : undefined;
    const xProfileId = isXIntent && typeof meta?.profileId === "string" ? meta.profileId : undefined;
    const xSkillId = intent.intentType === "x_post" && typeof meta?.skillId === "string" ? meta.skillId : undefined;

    // ── Execute: prefer skill for x_post if skillId is set, else use full task ──
    let buResult: { ok: boolean; taskId?: string; output?: unknown; raw?: unknown; error?: string; liveUrl?: string; handoffUrl?: string; sessionId?: string };
    if (xSkillId && xPostMeta) {
      console.log("[executeIntent] using skill for x_post:", xSkillId);
      const skillResult = await callBrowserUseSkill(
        xSkillId,
        {
          tweetText: xPostMeta.postText,
          ...(xPostMeta.imageBase64 ? { imageBase64: xPostMeta.imageBase64 } : {}),
        },
        args.apiKey,
        { profileId: xProfileId },
      );
      buResult = {
        ok: skillResult.ok,
        output: skillResult.result,
        error: skillResult.error,
      };
    } else {
      buResult = await callBrowserUseTask(buTask, args.apiKey, {
        allowedDomains: xAllowedDomains,
        profileId: xProfileId,
        proxyCountryCode: isXIntent ? "us" : undefined,
        keepAlive: isXIntent,
        sessionId: args.sessionId,
      });
    }
    let doneTs = now();

    // ── Email verification (non-fatal) ──
    if (buResult.ok && agentInboxId && shouldProvisionEmail) {
      try {
        console.log("[executeIntent] polling for verification email...");
        const pollResult = await ctx.runAction(internal.agentmail.pollForVerificationEmail, {
          inboxId: agentInboxId,
          knownMessageIds,
          timeoutSeconds: 60,
          pollIntervalSeconds: 5,
        });

        let verifyMethod: string | null = null;
        let verifyOk = false;

        if (pollResult.found && pollResult.verificationLink) {
          // Link-based verification (existing path)
          const fetchResult = await tryVerifyViaFetch(pollResult.verificationLink);
          if (fetchResult.ok) {
            verifyMethod = "fetch";
            verifyOk = true;
          } else {
            console.log("[executeIntent] fetch verify failed, falling back to browser-use...");
            const buVerify = await callBrowserUseTask(
              `Navigate to this URL and click any "verify" or "confirm" button you see: ${pollResult.verificationLink}`,
              args.apiKey,
              { maxSteps: 5, timeoutMs: 60_000 },
            );
            verifyMethod = "browser_use";
            verifyOk = buVerify.ok;
          }
        } else if (pollResult.found && pollResult.verificationCode) {
          // Code-based verification: re-enter code on the same browser session
          const code = pollResult.verificationCode;
          console.log(`[executeIntent] found verification code (${code.length} digits), entering via browser-use on same session...`);
          const codeEntryTask = [
            "You are on X.com's email verification screen.",
            `Enter the verification code: ${code}`,
            "Type this code into the verification code input field and click the 'Next' or 'Submit' button.",
            "After verification succeeds, set the password if prompted and continue with account setup.",
            "If you see a CAPTCHA or additional verification, attempt to complete it.",
            "Report the final status when done.",
          ].join("\n");

          const codeResult = await callBrowserUseTask(codeEntryTask, args.apiKey, {
            sessionId: buResult.sessionId,
            maxSteps: 15,
            timeoutMs: 120_000,
            allowedDomains: xAllowedDomains,
            keepAlive: true,
          });
          verifyMethod = "code_reentry";
          verifyOk = codeResult.ok;

          if (codeResult.ok) {
            console.log("[executeIntent] code re-entry succeeded, updating buResult");
            buResult = codeResult;
            doneTs = now();
          } else {
            console.warn("[executeIntent] code re-entry failed:", codeResult.error);
          }
        }

        await ctx.runMutation(secretsRef()._recordEvent, {
          intentId: intent.intentId,
          eventType: "email_verification_attempted",
          payloadJson: JSON.stringify({
            runId,
            traceId,
            inboxId: agentInboxId,
            emailFound: pollResult.found,
            linkFound: !!pollResult.verificationLink,
            codeFound: !!pollResult.verificationCode,
            codeValue: pollResult.verificationCode ?? null,
            verifyMethod,
            verifyOk,
            pollError: pollResult.error,
          }),
          createdAt: now(),
        });

        // ── Post-verification resume: login + billing + API key ──
        if (verifyOk && intent.intentType === "api_key_purchase" && apiKeyMeta !== null) {
          const resumeProvider = intent.provider ?? apiKeyMeta.provider;
          const resumeDomain = getApiKeyProviderDomain(resumeProvider);
          if (resumeDomain) {
            try {
              console.log("[executeIntent] verification done, launching resume browser-use for login+billing+key...");
              const resumeTask = buildApiKeyResumeTask({
                provider: resumeProvider,
                providerDomain: resumeDomain,
                targetProduct: apiKeyMeta.targetProduct,
                agentCredentialInstructions: agentCredentialInstructions ?? "",
                treasuryCardInstructions: treasuryCardInstructions ?? "",
              });
              const resumeResult = await callBrowserUseTask(resumeTask, args.apiKey, { timeoutMs: 180_000 });
              const resumeDoneTs = now();

              await ctx.runMutation(secretsRef()._recordEvent, {
                intentId: intent.intentId,
                eventType: "browser_use_resumed",
                payloadJson: JSON.stringify({
                  runId,
                  traceId,
                  taskId: resumeResult.taskId ?? null,
                  ok: resumeResult.ok,
                  error: resumeResult.error ?? null,
                }),
                createdAt: resumeDoneTs,
              });

              if (resumeResult.ok) {
                console.log("[executeIntent] resume browser-use succeeded, replacing buResult");
                buResult = resumeResult;
                doneTs = resumeDoneTs;
              } else {
                console.warn("[executeIntent] resume browser-use failed (non-fatal):", resumeResult.error);
              }
            } catch (resumeErr: any) {
              console.error("[executeIntent] resume browser-use threw (non-fatal):", resumeErr?.message);
              try {
                await ctx.runMutation(secretsRef()._recordEvent, {
                  intentId: intent.intentId,
                  eventType: "browser_use_resumed",
                  payloadJson: JSON.stringify({
                    runId,
                    traceId,
                    ok: false,
                    error: resumeErr?.message ?? "unknown",
                  }),
                  createdAt: now(),
                });
              } catch {
                console.error("[executeIntent] failed to record resume event");
              }
            }
          }
        }
      } catch (e: any) {
        console.error("[executeIntent] email verification failed (non-fatal):", e?.message);
        try {
          await ctx.runMutation(secretsRef()._recordEvent, {
            intentId: intent.intentId,
            eventType: "email_verification_attempted",
            payloadJson: JSON.stringify({
              runId,
              traceId,
              inboxId: agentInboxId,
              error: e?.message ?? "unknown",
            }),
            createdAt: now(),
          });
        } catch {
          console.error("[executeIntent] failed to record verification event");
        }
      }
    }

    if (!buResult.ok) {
      const sanitizedRaw =
        buResult.raw === undefined
          ? null
          : redactSensitiveOutput(buResult.raw, sensitiveTokens);
      const sanitizedError =
        buResult.error === undefined || buResult.error === null
          ? buResult.error
          : `${redactSensitiveOutput(buResult.error, sensitiveTokens)}`;
      const handoffUrl = buResult.handoffUrl ?? buildBrowserUseHandoffUrl(buResult.taskId);
      const errLower = (buResult.error ?? "").toLowerCase();
      const isRecoverableIntent = intent.intentType === "account_bootstrap" || intent.intentType === "api_key_purchase" || intent.intentType === "x_account_bootstrap";
      const isRecoverableError = errLower.includes("timeout") || errLower.includes("captcha") || errLower.includes("bot protection") || errLower.includes("arkose") || errLower.includes("blocked");
      const isRecoverable = isRecoverableIntent && isRecoverableError;
      if (isRecoverable) {
        const liveUrl = buResult.liveUrl ?? null;
        const buSessionId = buResult.sessionId ?? null;
        const nextAction =
          intent.intentType === "api_key_purchase"
            ? "Open handoffUrl, complete login/billing/key creation on provider domain, then call intent_resume."
            : liveUrl
              ? "1) Open liveUrl to see the live browser. 2) Solve the captcha manually. 3) Call intent_resume with the sessionId to continue."
              : "Open handoffUrl and continue from the interrupted step, then call intent_resume.";
        await ctx.runMutation(intentsRef()._updateRun, {
          runId,
          status: "action_required",
          outputJson: JSON.stringify({
            taskId: buResult.taskId ?? null,
            handoffUrl,
            liveUrl,
            sessionId: buSessionId,
            raw: sanitizedRaw,
            nextAction,
            ...(intent.intentType === "api_key_purchase"
              ? { provider: intent.provider ?? null }
              : {}),
            ...(treasuryPaymentArtifact ?? {}),
          }),
          error: sanitizedError ?? "execution_timeout",
          updatedAt: doneTs,
        });
        await ctx.runMutation(intentsRef()._setIntentStatus, {
          intentId: intent.intentId,
          status: "action_required",
          updatedAt: doneTs,
        });
        await ctx.runMutation(secretsRef()._recordEvent, {
          intentId: intent.intentId,
          eventType: "intent_action_required",
          payloadJson: JSON.stringify({
            runId,
            traceId,
            reason: sanitizedError ?? "execution_timeout",
            taskId: buResult.taskId ?? null,
            handoffUrl,
            liveUrl,
            sessionId: buSessionId,
            nextAction,
          }),
          createdAt: doneTs,
        });
        return {
          runId,
          status: "action_required",
          ...(intent.intentType === "api_key_purchase" ? { provider: intent.provider ?? "unknown" } : {}),
          reason: sanitizedError ?? "execution_timeout",
          nextAction,
          taskId: buResult.taskId ?? null,
          traceId,
          handoffUrl,
          liveUrl,
          sessionId: buSessionId,
          ...(treasuryPaymentArtifact ?? {}),
        };
      }

      await ctx.runMutation(intentsRef()._updateRun, {
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

      await ctx.runMutation(intentsRef()._setIntentStatus, {
        intentId: intent.intentId,
        status: "failed",
        updatedAt: doneTs,
      });

      if (holdAmountCents > 0) {
        await ctx.runMutation(accountsRef()._releaseHeldFundsForIntent, {
          userId: intent.userId,
          intentId: intent.intentId,
          amountCents: holdAmountCents,
          refType: "execution_failed",
          refId: runId,
        });
      }

      await ctx.runMutation(secretsRef()._recordEvent, {
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

      await emitTrace({
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
      const secret = await ctx.runQuery(secretsRef()._getLatestWalletSecret, { userId: intent.userId });
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

    await ctx.runMutation(intentsRef()._updateRun, {
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
      await ctx.runMutation(accountsRef()._settleHeldFundsForIntent, {
        userId: intent.userId,
        intentId: intent.intentId,
        amountCents: holdAmountCents,
        refType: "execution_ok",
        refId: runId,
      });
    }

    await ctx.runMutation(intentsRef()._setIntentStatus, {
      intentId: intent.intentId,
      status: handoffNeeded ? "action_required" : "confirmed",
      updatedAt: doneTs,
    });

    await ctx.runMutation(secretsRef()._recordEvent, {
      intentId: intent.intentId,
      eventType: "intent_execution_confirmed",
      payloadJson: JSON.stringify({ runId, traceId, taskId: buResult.taskId ?? null, handoffNeeded, handoffUrl }),
      createdAt: doneTs,
    });

    await emitTrace({
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
      const provider = intent.provider ?? apiKeyMeta?.provider ?? "unknown";
      const extracted = extractLikelyApiKey(buResult.output);
      const proofRef = randomId("proof");
      await ctx.runMutation(secretsRef()._putSecret, {
        secretRef: proofRef,
        userId: intent.userId,
        intentId: intent.intentId,
        provider,
        secretType: "api_key_proof",
        secretValue: JSON.stringify({
          traceId,
          taskId: buResult.taskId ?? null,
          output: sanitizedOutput ?? null,
          handoffUrl,
          provider,
        }),
      });

      if (handoffNeeded) {
        const nextAction =
          "Open handoffUrl and complete signup/login, billing/credits, key creation, then resume.";
        return {
          runId,
          status: "action_required",
          provider,
          taskId: buResult.taskId ?? null,
          output: sanitizedOutput ?? null,
          traceId,
          handoffUrl,
          reason: "manual_steps_required",
          nextAction,
          proofRef,
          ...(treasuryPaymentArtifact ?? {}),
        };
      }

      const secretRef = randomId("sec");
      await ctx.runMutation(secretsRef()._putSecret, {
        secretRef,
        userId: intent.userId,
        intentId: intent.intentId,
        provider,
        secretType: "api_key",
        secretValue: extracted ?? "PENDING_CAPTURE",
      });

      const validation =
        extracted === null
          ? { supported: false, verified: false, error: "key_not_detected" }
          : await bestEffortValidateApiKey({ provider, apiKey: extracted });
      const unverified = !validation.supported || !validation.verified;
      return {
        runId,
        status: "ok",
        provider,
        taskId: buResult.taskId ?? null,
        output: sanitizedOutput ?? null,
        traceId,
        handoffUrl,
        proofRef,
        credential: {
          secretRef,
        },
        artifact: {
          unverified,
          keyValidation: validation,
        },
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
