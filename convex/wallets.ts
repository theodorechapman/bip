import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { Keypair } from "@solana/web3.js";
import { randomId, now, getSolAutoSpendCapUsd } from "./lib/paymentsUtils";
import { sendSolTransfer } from "./lib/solana";

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

export const listUserWalletAddresses = internalQuery({
  args: { userId: v.id("users"), chain: v.string() },
  handler: async (ctx, args) => {
    const wallets = await ctx.db
      .query("agentWallets")
      .withIndex("by_user_id_and_chain", (q) => q.eq("userId", args.userId).eq("chain", args.chain))
      .collect();
    return wallets.map((wallet) => wallet.address);
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

    const wallets = (internal as any).wallets;
    const walletRows = await ctx.runQuery(wallets.getWalletByAddressForUser, {
      userId: args.userId,
      address: args.fromAddress,
    });
    if (walletRows === null) throw new Error("from_wallet_not_found");

    const secret = await ctx.runQuery(wallets.getWalletSecretByAddressForUser, {
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
