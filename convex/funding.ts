import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { now, solLamportsToFundingCents } from "./lib/paymentsUtils";
import { scanInboundSolanaFundingTxs } from "./lib/solana";
import { creditUserFundsRecord } from "./accounts";

function clampFundingSyncMaxTx(value: number | undefined): number {
  if (!Number.isFinite(value)) return 25;
  return Math.min(100, Math.max(1, Math.floor(value as number)));
}

export const listCreditedSolanaLedgerRefsForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_user_id_and_created_at", (q) => q.eq("userId", args.userId))
      .collect();
    return rows
      .filter(
        (row) =>
          row.type === "deposit" &&
          row.refType === "solana_settled" &&
          typeof row.refId === "string" &&
          row.refId.length > 0,
      )
      .map((row) => ({
        txSig: row.refId as string,
        amountCents: row.amountCents,
        createdAt: row.createdAt,
      }));
  },
});

export const settleSolanaFundingTx = internalMutation({
  args: {
    userId: v.id("users"),
    txSig: v.string(),
    walletAddress: v.string(),
    lamports: v.number(),
    slot: v.optional(v.number()),
    blockTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existingProcessed = await ctx.db
      .query("processedFundingTxs")
      .withIndex("by_chain_and_tx_sig", (q) => q.eq("chain", "solana").eq("txSig", args.txSig))
      .unique();
    if (existingProcessed !== null) {
      return {
        ok: true,
        credited: false,
        alreadyCredited: true,
        reason: "already_processed",
        txSig: args.txSig,
        amountCents: existingProcessed.amountCents,
      };
    }

    const existingLedgerRows = await ctx.db
      .query("ledgerEntries")
      .withIndex("by_ref_type_and_ref_id", (q) => q.eq("refType", "solana_settled").eq("refId", args.txSig))
      .take(1);
    const existingLedger = existingLedgerRows[0] ?? null;
    if (existingLedger !== null) {
      await ctx.db.insert("processedFundingTxs", {
        chain: "solana",
        txSig: args.txSig,
        userId: existingLedger.userId,
        walletAddress: args.walletAddress,
        lamports: args.lamports,
        amountCents: Math.max(0, existingLedger.amountCents),
        slot: args.slot,
        blockTime: args.blockTime,
        createdAt: now(),
      });
      return {
        ok: true,
        credited: false,
        alreadyCredited: true,
        reason: "already_credited",
        txSig: args.txSig,
        amountCents: Math.max(0, existingLedger.amountCents),
      };
    }

    const amountCents = solLamportsToFundingCents(args.lamports);
    const credited = await creditUserFundsRecord(ctx, {
      userId: args.userId,
      amountCents,
      refType: "solana_settled",
      refId: args.txSig,
    });
    await ctx.db.insert("processedFundingTxs", {
      chain: "solana",
      txSig: args.txSig,
      userId: args.userId,
      walletAddress: args.walletAddress,
      lamports: args.lamports,
      amountCents,
      slot: args.slot,
      blockTime: args.blockTime,
      createdAt: now(),
    });
    return {
      ok: true,
      credited: true,
      alreadyCredited: false,
      txSig: args.txSig,
      amountCents,
      availableCents: credited.availableCents,
      heldCents: credited.heldCents,
    };
  },
});

export const getSolanaFundingStatus = internalAction({
  args: {
    userId: v.id("users"),
    maxTx: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxTx = clampFundingSyncMaxTx(args.maxTx);
    const walletsRef = (internal as any).wallets;
    const fundingRef = (internal as any).funding;
    const walletAddresses = (await ctx.runQuery(walletsRef.listUserWalletAddresses, {
      userId: args.userId,
      chain: "solana",
    })) as Array<string>;
    const detected = await scanInboundSolanaFundingTxs({
      walletAddresses,
      maxTx,
    });

    const creditedRows = (await ctx.runQuery(
      fundingRef.listCreditedSolanaLedgerRefsForUser,
      { userId: args.userId },
    )) as Array<{ txSig: string; amountCents: number; createdAt: number }>;
    const creditedByTx = new Map(
      creditedRows.map((row) => [row.txSig, { amountCents: row.amountCents, createdAt: row.createdAt }]),
    );

    const txs = detected.map((row) => {
      const credited = creditedByTx.get(row.txSig);
      return {
        txSig: row.txSig,
        walletAddress: row.walletAddress,
        lamports: row.lamports,
        amountSol: row.amountSol,
        amountCents: row.amountCents,
        slot: row.slot,
        blockTime: row.blockTime,
        credited: credited !== undefined,
        creditedAmountCents: credited?.amountCents ?? null,
        creditedAt: credited?.createdAt ?? null,
      };
    });

    return {
      ok: true,
      chain: "solana",
      maxTx,
      walletCount: walletAddresses.length,
      detectedCount: txs.length,
      txs,
    };
  },
});

export const syncSolanaFundingForUser = internalAction({
  args: {
    userId: v.id("users"),
    maxTx: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxTx = clampFundingSyncMaxTx(args.maxTx);
    const fundingRef = (internal as any).funding;
    const status = (await ctx.runAction(fundingRef.getSolanaFundingStatus, {
      userId: args.userId,
      maxTx,
    })) as {
      txs: Array<{
        txSig: string;
        walletAddress: string;
        lamports: number;
        amountCents: number;
        slot: number | null;
        blockTime: number | null;
      }>;
    };

    const ordered = [...status.txs].sort((a, b) => {
      const aTime = a.blockTime ?? 0;
      const bTime = b.blockTime ?? 0;
      if (aTime !== bTime) return aTime - bTime;
      const aSlot = a.slot ?? 0;
      const bSlot = b.slot ?? 0;
      return aSlot - bSlot;
    });

    const creditedTxs: Array<{ txSig: string; amountCents: number }> = [];
    const alreadyCreditedTxs: Array<{ txSig: string; amountCents: number; reason: string }> = [];
    let totalCreditedCents = 0;
    for (const tx of ordered) {
      const settled = (await ctx.runMutation(fundingRef.settleSolanaFundingTx, {
        userId: args.userId,
        txSig: tx.txSig,
        walletAddress: tx.walletAddress,
        lamports: tx.lamports,
        slot: tx.slot ?? undefined,
        blockTime: tx.blockTime ?? undefined,
      })) as {
        credited: boolean;
        txSig: string;
        amountCents: number;
        reason?: string;
      };
      if (settled.credited) {
        creditedTxs.push({ txSig: settled.txSig, amountCents: settled.amountCents });
        totalCreditedCents += settled.amountCents;
      } else {
        alreadyCreditedTxs.push({
          txSig: settled.txSig,
          amountCents: settled.amountCents,
          reason: settled.reason ?? "already_credited",
        });
      }
    }

    return {
      ok: true,
      chain: "solana",
      maxTx,
      detectedCount: ordered.length,
      creditedCount: creditedTxs.length,
      alreadyCreditedCount: alreadyCreditedTxs.length,
      totalCreditedCents,
      creditedTxs,
      alreadyCreditedTxs,
    };
  },
});
