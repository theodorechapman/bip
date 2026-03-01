import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { now } from "./lib/paymentsUtils";

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

export const _getCJCredentialsForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("agentSecrets")
      .withIndex("by_user_id_and_created_at", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(50);
    const secret = rows.find((r: any) => r.provider === "cj" && r.secretType === "cj_account");
    if (!secret) return null;
    try {
      const parsed = JSON.parse(secret.secretValue) as { email?: string; password?: string };
      if (typeof parsed.email === "string" && typeof parsed.password === "string") {
        return { email: parsed.email, password: parsed.password };
      }
    } catch {
      /* ignore */
    }
    return null;
  },
});

export const _getShopifyConfigForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("agentSecrets")
      .withIndex("by_user_id_and_created_at", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(50);
    const secret = rows.find((r: any) => r.provider === "shopify" && r.secretType === "shopify_store");
    if (!secret) return null;
    try {
      const parsed = JSON.parse(secret.secretValue) as {
        domain?: string;
        accessToken?: string;
        [k: string]: unknown;
      };
      if (typeof parsed.domain === "string" && typeof parsed.accessToken === "string") {
        return { domain: parsed.domain, accessToken: parsed.accessToken };
      }
    } catch {
      /* ignore */
    }
    return null;
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
