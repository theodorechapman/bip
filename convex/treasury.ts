import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { parseTreasuryCardSecret } from "./lib/treasuryCard";

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
