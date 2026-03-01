import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { randomId, now } from "./lib/paymentsUtils";

/**
 * Credit user funds — plain TS helper, also exported for funding.ts to import.
 */
export async function creditUserFundsRecord(
  ctx: any,
  args: {
    userId: any;
    amountCents: number;
    refType?: string;
    refId?: string;
  },
): Promise<{ ok: boolean; availableCents: number; heldCents: number }> {
  if (args.amountCents <= 0) throw new Error("amountCents must be > 0");
  const ts = now();
  let account = await ctx.db
    .query("agentAccounts")
    .withIndex("by_user_id", (q: any) => q.eq("userId", args.userId))
    .unique();
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
  const available = account.availableCents + args.amountCents;
  await ctx.db.patch(account._id, { availableCents: available, updatedAt: ts });
  await ctx.db.insert("ledgerEntries", {
    entryId: randomId("le"),
    userId: args.userId,
    type: "deposit",
    amountCents: args.amountCents,
    balanceAfterAvailableCents: available,
    balanceAfterHeldCents: account.heldCents,
    refType: args.refType,
    refId: args.refId,
    createdAt: ts,
  });
  return { ok: true, availableCents: available, heldCents: account.heldCents };
}

export const _creditUserFunds = internalMutation({
  args: { userId: v.id("users"), amountCents: v.number(), refType: v.optional(v.string()), refId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    return await creditUserFundsRecord(ctx, args);
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
