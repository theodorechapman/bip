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
import { solveArkoseCaptcha, detectCaptchaBlock, getXArkosePublicKey } from "./lib/captchaSolver";

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

    // ── Shopify product/order intents: direct API execution (no browser-use) ──
    const shopifyApiIntents = ["shopify_source_products", "shopify_list_products", "shopify_fulfill_orders", "shopify_cycle"];
    if (shopifyApiIntents.includes(intent.intentType ?? "")) {
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
      intent.intentType === "giftcard_purchase" ||
      intent.intentType === "cj_account_bootstrap" ||
      intent.intentType === "shopify_store_create";

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

    const requiresInbox =
      intent.intentType === "x_account_bootstrap" ||
      intent.intentType === "account_bootstrap" ||
      intent.intentType === "cj_account_bootstrap" ||
      intent.intentType === "shopify_store_create";
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

    // Snapshot existing message IDs (for verification email polling)
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

    // ── CJ Account Bootstrap: signup + verify + store creds per agent ──
    if (intent.intentType === "cj_account_bootstrap" && agentEmail && agentPassword && agentInboxId) {
      const cjSignupTask = `You are automating signup on CJ Dropshipping.

STEP 1 - SIGN UP:
1. Go to https://cjdropshipping.com/register
2. Find the registration form
3. Email: ${agentEmail}
4. Password: ${agentPassword}
5. If there's a "confirm password" field, enter the same password again
6. Accept any terms/agreements checkbox
7. Click the Register/Sign Up button

After signup, if the site asks you to verify your email, report "VERIFICATION_NEEDED".
If signup completes without email verification, report "SIGNUP_COMPLETE".
If you encounter CAPTCHAs, try to solve them. If blocked, report "BLOCKED_BY_CAPTCHA".
If you encounter issues, report "FAILED: <reason>".`;

      const buResultCj = await callBrowserUseTask(cjSignupTask, undefined, {
        maxSteps: 25,
        timeoutMs: 180_000,
        allowedDomains: ["*.cjdropshipping.com", "*.cjcommerce.com"],
      });

      const signupOutput = String(buResultCj.output ?? "");

      if (buResultCj.ok && !signupOutput.includes("BLOCKED_BY_CAPTCHA") && !signupOutput.includes("FAILED")) {
        let verified = signupOutput.includes("SIGNUP_COMPLETE");
        if (!verified && (signupOutput.includes("VERIFICATION_NEEDED") || signupOutput.includes("verify"))) {
          const pollResult = await ctx.runAction(internal.agentmail.pollForVerificationEmail, {
            inboxId: agentInboxId,
            knownMessageIds,
            timeoutSeconds: 90,
            pollIntervalSeconds: 5,
          });
          if (pollResult.found && (pollResult.verificationLink || pollResult.verificationCode)) {
            const verifyTask = pollResult.verificationLink
              ? `Navigate to this verification link and complete email verification:\n${pollResult.verificationLink}\n\nAfter verification is complete, report "VERIFIED".`
              : `Enter this verification code on the CJ Dropshipping page: ${pollResult.verificationCode}\n\nFind the verification code input field and enter the code, then submit. After verification is complete, report "VERIFIED".`;
            const verifyResult = await callBrowserUseTask(verifyTask, undefined, {
              maxSteps: 15,
              timeoutMs: 120_000,
              sessionId: buResultCj.sessionId,
            });
            verified = verifyResult.ok && String(verifyResult.output ?? "").includes("VERIFIED");
          }
        }
        if (verified) {
          const credentialRef = randomId("sec");
          await ctx.runMutation(secretsRef()._putSecret, {
            secretRef: credentialRef,
            userId: intent.userId,
            intentId: intent.intentId,
            provider: "cj",
            secretType: "cj_account",
            secretValue: JSON.stringify({ email: agentEmail, password: agentPassword }),
          });
          const doneTs = now();
          await ctx.runMutation(intentsRef()._updateRun, {
            runId,
            status: "ok",
            outputJson: JSON.stringify({ email: agentEmail, credentialRef }),
            error: null,
            updatedAt: doneTs,
          });
          if (holdAmountCents > 0) {
            await ctx.runMutation(accountsRef()._settleHeldFundsForIntent, {
              userId: intent.userId,
              intentId: intent.intentId,
              amountCents: holdAmountCents,
              refType: "cj_bootstrap",
              refId: runId,
            });
          }
          await ctx.runMutation(intentsRef()._setIntentStatus, {
            intentId: intent.intentId,
            status: "confirmed",
            updatedAt: doneTs,
          });
          return { runId, status: "ok", traceId, credentialRef, email: agentEmail };
        }
      }
      const doneTs = now();
      await ctx.runMutation(intentsRef()._updateRun, {
        runId,
        status: "failed",
        outputJson: buResultCj.output ? JSON.stringify({ raw: String(buResultCj.output) }) : null,
        error: buResultCj.error ?? "cj_signup_failed",
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
        error: buResultCj.error ?? "cj_signup_failed",
        traceId,
        handoffUrl: buResultCj.handoffUrl,
      };
    }

    // ── Shopify Store Create: step-chained to stay within Convex action timeout ──
    if (intent.intentType === "shopify_store_create" && agentEmail && agentPassword && agentInboxId) {
      const storeName =
        (typeof meta?.storeName === "string" && meta.storeName.trim()) || `store-${Date.now()}`;
      const niche = (typeof meta?.niche === "string" && meta.niche.trim()) || "general";

      await ctx.scheduler.runAfter(0, executorRef().shopifyStoreStep, {
        step: "signup",
        intentId: intent.intentId,
        userId: intent.userId,
        runId,
        traceId,
        holdAmountCents,
        agentEmail,
        agentPassword,
        agentInboxId,
        knownMessageIds,
        storeName,
        niche,
        sessionId: "",
        shopifyDomain: "",
      });
      return { runId, status: "executing", traceId, message: "Shopify store creation started (step: signup)" };
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

    // ── Captcha auto-solve for x_account_bootstrap ──
    if (
      !buResult.ok &&
      intent.intentType === "x_account_bootstrap" &&
      detectCaptchaBlock(buResult.error, buResult.output)
    ) {
      console.log("[executeIntent] captcha block detected in x_account_bootstrap, attempting 2captcha solve...");
      const arkoseKey = getXArkosePublicKey("signup");
      const solveResult = await solveArkoseCaptcha({
        publicKey: arkoseKey,
        pageUrl: "https://x.com/i/flow/signup",
      });

      // Record the solve attempt
      try {
        await ctx.runMutation(secretsRef()._recordEvent, {
          intentId: intent.intentId,
          eventType: "captcha_solve_attempted",
          payloadJson: JSON.stringify({
            runId,
            traceId,
            solveOk: solveResult.ok,
            elapsedMs: solveResult.elapsedMs ?? null,
            error: solveResult.error ?? null,
          }),
          createdAt: now(),
        });
      } catch {
        console.error("[executeIntent] failed to record captcha_solve_attempted event");
      }

      if (solveResult.ok && solveResult.token && buResult.sessionId) {
        console.log(`[executeIntent] captcha solved in ${solveResult.elapsedMs}ms, injecting token via browser-use...`);
        const tokenInjectionTask = [
          "A FunCaptcha/Arkose verification token has been solved externally.",
          "You need to inject this token into the page to bypass the captcha and continue signup.",
          "",
          "Try these approaches in order:",
          `1) Execute this JavaScript in the browser console: document.querySelector('[name=fc-token]').value = '${solveResult.token}';`,
          "   Then find and click the submit/verify/next button.",
          "2) If there is no fc-token input, look for any Arkose/FunCaptcha iframe or callback.",
          `   Try: window.parent.postMessage(JSON.stringify({eventId:'challenge-complete',payload:{sessionToken:'${solveResult.token}'}}), '*');`,
          "3) If none of the above work, try pasting the token into any visible verification input field.",
          "",
          "After the captcha is resolved, continue with the X signup flow:",
          "- Complete any remaining signup steps",
          "- When asked for email verification code, STOP and wait on the verification code input screen",
          "- Report the final status",
        ].join("\n");

        const injectResult = await callBrowserUseTask(tokenInjectionTask, args.apiKey, {
          sessionId: buResult.sessionId,
          maxSteps: 20,
          timeoutMs: 120_000,
          allowedDomains: xAllowedDomains,
          keepAlive: true,
        });

        if (injectResult.ok) {
          console.log("[executeIntent] captcha token injection succeeded, continuing flow");
          buResult = injectResult;
          doneTs = now();
        } else {
          console.warn("[executeIntent] captcha token injection failed:", injectResult.error);
          // Fall through to existing action_required handling
        }
      } else if (!solveResult.ok) {
        console.warn("[executeIntent] 2captcha solve failed:", solveResult.error);
        // Fall through to existing action_required handling
      } else {
        console.warn("[executeIntent] captcha solved but no sessionId to inject into");
        // Fall through to existing action_required handling
      }
    }

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

// ── Shopify Store Create: step-chained action ──────────────────────
// Each step runs one Browser Use task and schedules the next, staying
// within Convex's per-action timeout (~10 min).

type ShopifyStoreStepName = "signup" | "verify" | "configure" | "token_extract" | "token_create_app";

const shopifyStoreStepArgs = {
  step: v.string(),
  intentId: v.string(),
  userId: v.id("users"),
  runId: v.string(),
  traceId: v.string(),
  holdAmountCents: v.number(),
  agentEmail: v.string(),
  agentPassword: v.string(),
  agentInboxId: v.string(),
  knownMessageIds: v.array(v.string()),
  storeName: v.string(),
  niche: v.string(),
  sessionId: v.string(),
  shopifyDomain: v.string(),
};

async function failShopifyStep(
  ctx: any,
  args: { intentId: string; userId: any; runId: string; holdAmountCents: number },
  error: string,
  outputJson?: string | null,
) {
  const ts = now();
  await ctx.runMutation(intentsRef()._updateRun, {
    runId: args.runId,
    status: "failed",
    outputJson: outputJson ?? null,
    error,
    updatedAt: ts,
  });
  if (args.holdAmountCents > 0) {
    await ctx.runMutation(accountsRef()._releaseHeldFundsForIntent, {
      userId: args.userId,
      intentId: args.intentId,
      amountCents: args.holdAmountCents,
      refType: "execution_failed",
      refId: args.runId,
    });
  }
  await ctx.runMutation(intentsRef()._setIntentStatus, {
    intentId: args.intentId,
    status: "failed",
    updatedAt: ts,
  });
}

export const shopifyStoreStep = internalAction({
  args: shopifyStoreStepArgs,
  handler: async (ctx, args): Promise<any> => {
    const step = args.step as ShopifyStoreStepName;

    // ── STEP: signup ──
    if (step === "signup") {
      const signupTask = `You are automating Shopify store creation.

STEP 1 - SIGN UP FOR SHOPIFY FREE TRIAL:
1. Go to https://www.shopify.com/free-trial
2. Click "Start free trial"
3. If asked "What are you looking to do?", select "Start an online store"
4. Answer onboarding questions based on the niche "${args.niche}"
5. When asked for email, enter: ${args.agentEmail}
6. When asked for password, enter: ${args.agentPassword}
7. Fill in business info: country = United States, use any US address
8. Complete the signup flow

IMPORTANT:
- Be patient with page loads. If clicking/typing fails, try Tab navigation or wait(3).
- If you see CAPTCHAs, try to solve them. If blocked, report "BLOCKED_BY_CAPTCHA".
- If signup asks for email verification, report "VERIFICATION_NEEDED".
- If signup completes without verification, report "SIGNUP_COMPLETE" and the store URL.
- If you encounter issues, report "FAILED: <reason>".`;

      const buSignup = await callBrowserUseTask(signupTask, undefined, {
        maxSteps: 35,
        timeoutMs: 300_000,
        allowedDomains: ["*.shopify.com", "*.myshopify.com", "*.accounts.shopify.com"],
        keepAlive: true,
      });

      const output = String(buSignup.output ?? "");
      if (!buSignup.ok || output.includes("BLOCKED_BY_CAPTCHA") || output.includes("FAILED")) {
        await failShopifyStep(ctx, args, buSignup.error ?? "shopify_signup_failed", JSON.stringify({ raw: output }));
        return;
      }

      await ctx.runMutation(secretsRef()._recordEvent, {
        intentId: args.intentId,
        eventType: "shopify_step_signup_done",
        payloadJson: JSON.stringify({ output: output.slice(0, 500) }),
        createdAt: now(),
      });

      await ctx.scheduler.runAfter(0, executorRef().shopifyStoreStep, {
        ...args,
        step: "verify",
        sessionId: buSignup.sessionId ?? "",
        shopifyDomain: (output.match(/([a-z0-9-]+\.myshopify\.com)/i) ?? [])[1] ?? "",
      });
      return;
    }

    // ── STEP: verify ──
    if (step === "verify") {
      const signupOutput = await getLastStepOutput(ctx, args.intentId, "shopify_step_signup_done");
      const alreadyVerified = signupOutput.includes("SIGNUP_COMPLETE");

      let verified = alreadyVerified;
      if (!verified) {
        const pollResult = await ctx.runAction(internal.agentmail.pollForVerificationEmail, {
          inboxId: args.agentInboxId,
          knownMessageIds: args.knownMessageIds,
          timeoutSeconds: 120,
          pollIntervalSeconds: 5,
        });
        if (pollResult.found && (pollResult.verificationLink || pollResult.verificationCode)) {
          const verifyTask = pollResult.verificationLink
            ? `Navigate to this verification link and complete the email verification:\n${pollResult.verificationLink}\n\nAfter clicking, wait for the page to load. Then navigate to the Shopify admin dashboard. Report the store URL (e.g. something.myshopify.com) you end up on.`
            : `Enter this verification code on the Shopify page: ${pollResult.verificationCode}\n\nAfter verification, navigate to the admin dashboard. Report the store URL (e.g. something.myshopify.com).`;
          const verifyResult = await callBrowserUseTask(verifyTask, undefined, {
            maxSteps: 20,
            timeoutMs: 120_000,
            sessionId: args.sessionId || undefined,
            allowedDomains: ["*.shopify.com", "*.myshopify.com", "*.accounts.shopify.com"],
            keepAlive: true,
          });
          verified = verifyResult.ok;
          const verifyOutput = String(verifyResult.output ?? "");
          const dm = verifyOutput.match(/([a-z0-9-]+\.myshopify\.com)/i);
          if (dm && !args.shopifyDomain) args.shopifyDomain = dm[1];
          if (verifyResult.sessionId) args.sessionId = verifyResult.sessionId;
        }
      }

      if (!verified) {
        await failShopifyStep(ctx, args, "shopify_verification_failed");
        return;
      }

      await ctx.scheduler.runAfter(0, executorRef().shopifyStoreStep, {
        ...args,
        step: "configure",
      });
      return;
    }

    // ── STEP: configure (set store name, extract domain) ──
    if (step === "configure") {
      const configTask = `You are in a Shopify admin dashboard. Configure the store:

1. Go to Settings (gear icon) and set store name to "${args.storeName}" if not set
2. Ensure store currency is USD
3. Get the store URL from the browser (something.myshopify.com) or Settings > Domains
4. Report ONLY the store domain (e.g. my-store.myshopify.com) as your final answer`;

      const configResult = await callBrowserUseTask(configTask, undefined, {
        maxSteps: 25,
        timeoutMs: 180_000,
        sessionId: args.sessionId || undefined,
        allowedDomains: ["*.shopify.com", "*.myshopify.com"],
        keepAlive: true,
      });
      const configOutput = String(configResult.output ?? "");
      const dm = configOutput.match(/([a-z0-9-]+\.myshopify\.com)/i);
      const domain = dm ? dm[1] : args.shopifyDomain;

      if (!domain) {
        await failShopifyStep(ctx, args, "shopify_domain_not_captured", JSON.stringify({ raw: configOutput }));
        return;
      }

      await ctx.scheduler.runAfter(0, executorRef().shopifyStoreStep, {
        ...args,
        step: "token_extract",
        shopifyDomain: domain,
        sessionId: configResult.sessionId ?? args.sessionId,
      });
      return;
    }

    // ── STEP: token_extract ──
    // Shopify now uses dev.shopify.com "Dev Dashboard" which requires email
    // verification before you can create apps. We handle it in sub-steps:
    //   1. Navigate to dev dashboard, trigger email verification
    //   2. Poll AgentMail for the verification email
    //   3. Complete verification and create the app + extract token
    if (step === "token_extract") {
      const storeSlug = args.shopifyDomain.replace(".myshopify.com", "");

      // Sub-step 1: Navigate to dev dashboard and trigger email verification
      const devDashTask = `You are automating Shopify app development setup.

1. Go to https://admin.shopify.com/store/${storeSlug}/settings/apps/development
2. If not logged in, sign in with: Email: ${args.agentEmail}  Password: ${args.agentPassword}
3. Look for a "Develop apps" or "Create an app" button. If you see it, click it.
4. If instead you see "Build apps in Dev Dashboard" or a link to dev.shopify.com, click it.
5. If the Dev Dashboard (dev.shopify.com) asks you to verify your email, click the verify/send email button.
6. After triggering the verification email, STOP and report one of:
   - "DEV_DASHBOARD_VERIFY_NEEDED" if email verification was requested
   - "CREATE_APP_READY" if you can already create an app (no verification needed)
   - "TOKEN_FOUND: shpat_xxxxx" if you somehow already see an access token
   - "FAILED: <reason>" if something went wrong

IMPORTANT: Do NOT try to check email yourself. Just trigger the verification and stop.`;

      const devResult = await callBrowserUseTask(devDashTask, undefined, {
        maxSteps: 30,
        timeoutMs: 300_000,
        sessionId: args.sessionId || undefined,
        allowedDomains: ["*.shopify.com", "*.myshopify.com", "*.accounts.shopify.com", "dev.shopify.com"],
        keepAlive: true,
      });

      const devOutput = String(devResult.output ?? "");

      // Check if token was found directly
      const earlyTokenMatch = devOutput.match(/shpat_[a-zA-Z0-9_-]+/);
      if (earlyTokenMatch) {
        await completeTokenExtraction(ctx, args, earlyTokenMatch[0]);
        return;
      }

      if (devOutput.includes("FAILED")) {
        await failShopifyStep(ctx, args, "shopify_dev_dashboard_failed", JSON.stringify({ raw: devOutput.slice(0, 1000) }));
        return;
      }

      // Sub-step 2: If verification needed, poll AgentMail and complete it
      if (devOutput.includes("DEV_DASHBOARD_VERIFY_NEEDED") || devOutput.toLowerCase().includes("verify")) {
        const pollResult = await ctx.runAction(internal.agentmail.pollForVerificationEmail, {
          inboxId: args.agentInboxId,
          knownMessageIds: args.knownMessageIds,
          timeoutSeconds: 120,
          pollIntervalSeconds: 5,
        });

        if (pollResult.found && (pollResult.verificationLink || pollResult.verificationCode)) {
          const verifyDevTask = pollResult.verificationLink
            ? `Navigate to this verification link to verify your Shopify developer email:\n${pollResult.verificationLink}\n\nAfter verification completes, report "DEV_VERIFIED".`
            : `Enter this verification code on the Shopify Dev Dashboard page: ${pollResult.verificationCode}\n\nAfter verification completes, report "DEV_VERIFIED".`;

          await callBrowserUseTask(verifyDevTask, undefined, {
            maxSteps: 15,
            timeoutMs: 120_000,
            sessionId: (devResult.sessionId ?? args.sessionId) || undefined,
            keepAlive: true,
          });
        }
      }

      // Sub-step 3: Now create the app and extract the token
      // Schedule as a new action to stay within timeout
      await ctx.scheduler.runAfter(0, executorRef().shopifyStoreStep, {
        ...args,
        step: "token_create_app",
        sessionId: devResult.sessionId ?? args.sessionId,
      });
      return;
    }

    // ── STEP: token_create_app (create app in dev dashboard + extract token) ──
    if (step === "token_create_app") {
      const storeSlug = args.shopifyDomain.replace(".myshopify.com", "");

      const createAppTask = `You are on the Shopify Dev Dashboard or admin. Create a custom app and extract the Admin API access token.

Try these approaches in order:

APPROACH 1 - Dev Dashboard (dev.shopify.com):
1. Go to https://dev.shopify.com or the Dev Dashboard link from Shopify admin
2. Look for "Apps" or "Create an app" 
3. Create an app named "bip-agent"
4. Connect it to the store "${args.shopifyDomain}"
5. Under API access / credentials, configure Admin API scopes (select all)
6. Install the app on the store
7. Find and reveal the Admin API access token (starts with shpat_)

APPROACH 2 - Admin Settings (legacy):
1. Go to https://admin.shopify.com/store/${storeSlug}/settings/apps/development
2. If you see "Create an app" button, click it
3. Name the app "bip-agent"
4. Go to Configuration > Admin API integration > Configure
5. Select ALL access scopes, Save
6. Click "Install app" and confirm
7. Click "Reveal token once" to see the token (starts with shpat_)

APPROACH 3 - Direct URL:
1. Go to https://admin.shopify.com/store/${storeSlug}/settings/apps/development/create
2. Follow the app creation flow

If asked to log in, use: Email: ${args.agentEmail}  Password: ${args.agentPassword}

Return ONLY the full access token string (starts with shpat_) as your final answer.
If you cannot get the token, report "FAILED: <specific reason>".

IMPORTANT: The token is shown only once. Copy it before navigating away.`;

      const tokenResult = await callBrowserUseTask(createAppTask, undefined, {
        maxSteps: 50,
        timeoutMs: 480_000,
        sessionId: args.sessionId || undefined,
        allowedDomains: ["*.shopify.com", "*.myshopify.com", "*.accounts.shopify.com", "dev.shopify.com"],
      });

      const tokenOutput = String(tokenResult.output ?? "");
      const tokenMatch = tokenOutput.match(/shpat_[a-zA-Z0-9_-]+/);
      const accessToken = tokenMatch ? tokenMatch[0] : null;

      if (!accessToken) {
        await failShopifyStep(ctx, args, "shopify_token_extraction_failed", JSON.stringify({ domain: args.shopifyDomain, raw: tokenOutput.slice(0, 1000) }));
        return;
      }

      await completeTokenExtraction(ctx, args, accessToken);
      return;
    }
  },
});

async function completeTokenExtraction(
  ctx: any,
  args: { intentId: string; userId: any; runId: string; holdAmountCents: number; shopifyDomain: string },
  accessToken: string,
) {
  const credentialRef = randomId("sec");
  await ctx.runMutation(secretsRef()._putSecret, {
    secretRef: credentialRef,
    userId: args.userId,
    intentId: args.intentId,
    provider: "shopify",
    secretType: "shopify_store",
    secretValue: JSON.stringify({ domain: args.shopifyDomain, accessToken }),
  });
  const ts = now();
  await ctx.runMutation(intentsRef()._updateRun, {
    runId: args.runId,
    status: "ok",
    outputJson: JSON.stringify({ domain: args.shopifyDomain, credentialRef }),
    error: null,
    updatedAt: ts,
  });
  if (args.holdAmountCents > 0) {
    await ctx.runMutation(accountsRef()._settleHeldFundsForIntent, {
      userId: args.userId,
      intentId: args.intentId,
      amountCents: args.holdAmountCents,
      refType: "shopify_store_create",
      refId: args.runId,
    });
  }
  await ctx.runMutation(intentsRef()._setIntentStatus, {
    intentId: args.intentId,
    status: "confirmed",
    updatedAt: ts,
  });
}

async function getLastStepOutput(ctx: any, intentId: string, eventType: string): Promise<string> {
  const events = await ctx.runQuery(intentsRef().getIntentEvents, { intentId });
  const match = events?.find((e: any) => e.eventType === eventType);
  if (!match?.payloadJson) return "";
  try {
    const parsed = JSON.parse(match.payloadJson);
    return typeof parsed.output === "string" ? parsed.output : "";
  } catch {
    return "";
  }
}
