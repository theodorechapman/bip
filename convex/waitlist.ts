import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const getByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    return await ctx.db
      .query("waitlistSignups")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
  },
});

export const insert = internalMutation({
  args: { email: v.string(), createdAt: v.number() },
  handler: async (ctx, { email, createdAt }) => {
    await ctx.db.insert("waitlistSignups", { email, createdAt });
  },
});
