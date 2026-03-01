import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

const DEFAULT_JOLTSMS_BASE_URL = "https://api.joltsms.com";

type JoltSmsRentResponse = {
  id?: unknown;
  phoneNumber?: unknown;
  status?: unknown;
  areaCode?: unknown;
};

type JoltSmsNumberResponse = {
  id?: unknown;
  phoneNumber?: unknown;
  status?: unknown;
};

function getJoltSmsConfig(): { baseUrl: string; apiKey: string } {
  const apiKey = process.env.JOLTSMS_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("JOLTSMS_API_KEY is not configured");
  }
  const baseUrl =
    process.env.JOLTSMS_BASE_URL?.trim() ?? DEFAULT_JOLTSMS_BASE_URL;
  return {
    baseUrl,
    apiKey,
  };
}

export const recordPhoneNumber = internalMutation({
  args: {
    userId: v.id("users"),
    numberId: v.string(),
    phoneNumber: v.string(),
    areaCode: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("joltsmsNumbers", {
      userId: args.userId,
      numberId: args.numberId,
      phoneNumber: args.phoneNumber,
      areaCode: args.areaCode,
      createdAt: Date.now(),
    });
    return null;
  },
});

export const getActiveNumber = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("joltsmsNumbers")
      .withIndex("by_user_id_and_created_at", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(1);
    const latest = docs[0] ?? null;
    if (latest === null) {
      return null;
    }
    return {
      numberId: latest.numberId,
      phoneNumber: latest.phoneNumber,
      areaCode: latest.areaCode,
    };
  },
});

export const setUserPhone = internalMutation({
  args: {
    userId: v.id("users"),
    phone: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (user === null) {
      throw new Error("User not found");
    }
    await ctx.db.patch(args.userId, {
      phone: args.phone,
    });
    return null;
  },
});

export const deleteNumberRecords = internalMutation({
  args: {
    userId: v.id("users"),
    numberId: v.string(),
  },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("joltsmsNumbers")
      .withIndex("by_user_id_and_number_id", (q) =>
        q.eq("userId", args.userId).eq("numberId", args.numberId),
      )
      .collect();
    for (const doc of docs) {
      await ctx.db.delete(doc._id);
    }
    return {
      deletedLocalRecords: docs.length,
    };
  },
});

export const rentPhoneNumber = internalAction({
  args: {
    userId: v.id("users"),
    areaCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.runQuery(internal.joltsms.getActiveNumber, {
      userId: args.userId,
    });
    if (existing !== null) {
      throw new Error(
        `Agent already has an active phone number (${existing.phoneNumber}). Delete it before renting another.`,
      );
    }

    const { baseUrl, apiKey } = getJoltSmsConfig();

    const body: Record<string, unknown> = { autoRenew: true };
    if (args.areaCode) {
      body.areaCode = args.areaCode;
      body.preferredAreaCode = true;
    }

    const response = await fetch(`${baseUrl}/v1/numbers/rent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const rawBody = await response.text();
    if (!response.ok) {
      throw new Error(
        `JoltSMS rent number failed (${response.status}): ${rawBody.slice(0, 300)}`,
      );
    }
    const decoded = JSON.parse(rawBody) as JoltSmsRentResponse;
    if (typeof decoded.id !== "string" || typeof decoded.phoneNumber !== "string") {
      throw new Error("JoltSMS response did not include id/phoneNumber");
    }

    const areaCode =
      typeof decoded.areaCode === "string" ? decoded.areaCode : null;

    await ctx.runMutation(internal.joltsms.recordPhoneNumber, {
      userId: args.userId,
      numberId: decoded.id,
      phoneNumber: decoded.phoneNumber,
      areaCode,
    });
    await ctx.runMutation(internal.joltsms.setUserPhone, {
      userId: args.userId,
      phone: decoded.phoneNumber,
    });

    return {
      numberId: decoded.id,
      phoneNumber: decoded.phoneNumber,
      areaCode,
    };
  },
});

export const releasePhoneNumber = internalAction({
  args: {
    userId: v.id("users"),
    numberId: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true; numberId: string; deletedLocalRecords: number }> => {
    const active = await ctx.runQuery(internal.joltsms.getActiveNumber, {
      userId: args.userId,
    });
    if (active === null) {
      throw new Error("No active phone number to release for this agent");
    }
    if (args.numberId !== active.numberId) {
      throw new Error("numberId does not match this agent's active phone number");
    }

    // Note: JoltSMS release is done via the billing subscription endpoint.
    // For now we just clean up local records. If JoltSMS exposes a direct
    // release endpoint in the future, we should call it here.
    const { baseUrl, apiKey } = getJoltSmsConfig();

    // Try to get number details to find subscription ID
    const numberResponse = await fetch(
      `${baseUrl}/v1/numbers/${encodeURIComponent(active.numberId)}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );
    if (numberResponse.ok) {
      const numberData = (await numberResponse.json()) as JoltSmsNumberResponse;
      // If there's a subscriptionId, cancel the subscription
      const subId = (numberData as Record<string, unknown>).subscriptionId;
      if (typeof subId === "string") {
        await fetch(
          `${baseUrl}/v1/billing/subscriptions/${encodeURIComponent(subId)}/auto-renew`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ autoRenew: false }),
          },
        );
      }
    }

    const cleanup = await ctx.runMutation(internal.joltsms.deleteNumberRecords, {
      userId: args.userId,
      numberId: active.numberId,
    });
    await ctx.runMutation(internal.joltsms.setUserPhone, {
      userId: args.userId,
      phone: null,
    });

    return {
      ok: true,
      numberId: active.numberId,
      deletedLocalRecords: cleanup.deletedLocalRecords,
    };
  },
});
