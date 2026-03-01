import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { v } from "convex/values";

const DEFAULT_AGENTMAIL_BASE_URL = "https://api.agentmail.to";

type AgentmailCreateInboxResponse = {
  inbox_id?: unknown;
  pod_id?: unknown;
  client_id?: unknown;
  email?: unknown;
};

type AgentmailDeleteInboxResponse = {
  success?: unknown;
};

function normalizeRequestedEmail(input: string): string {
  return input.trim().toLowerCase();
}

function normalizeInboxIdentifier(input: string): string {
  const value = input.trim().toLowerCase();
  if (value.length === 0) {
    throw new Error("inboxId must not be empty");
  }
  return value;
}

function parseRequestedEmail(
  requestedEmail: string,
): { username: string; domain: string | null; normalized: string } {
  const normalized = normalizeRequestedEmail(requestedEmail);
  if (normalized.length === 0) {
    throw new Error("Email must not be empty");
  }
  const parts = normalized.split("@");
  if (parts.length > 2) {
    throw new Error("Email format is invalid");
  }
  const username = parts[0] ?? "";
  if (!/^[a-z0-9._%+-]+$/.test(username)) {
    throw new Error("Email username has invalid characters");
  }
  if (parts.length === 1) {
    return {
      username,
      domain: null,
      normalized,
    };
  }
  const domain = parts[1] ?? "";
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    throw new Error("Email domain is invalid");
  }
  return {
    username,
    domain,
    normalized,
  };
}

function getAgentmailConfig(): { baseUrl: string; apiKey: string } {
  const apiKey = process.env.AGENTMAIL_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("AGENTMAIL_API_KEY is not configured");
  }
  const baseUrl =
    process.env.AGENTMAIL_BASE_URL?.trim() ?? DEFAULT_AGENTMAIL_BASE_URL;
  return {
    baseUrl,
    apiKey,
  };
}

function buildClientId(userId: string, requestedEmail: string): string {
  const raw = `bip-${userId}-${requestedEmail}`;
  const sanitized = raw
    .replace(/[^A-Za-z0-9._~-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  if (sanitized.length === 0) {
    return `bip-${userId}`;
  }
  return sanitized.slice(0, 120);
}

export const recordInbox = internalMutation({
  args: {
    userId: v.id("users"),
    requestedEmail: v.string(),
    inboxId: v.string(),
    podId: v.string(),
    clientId: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("agentmailInboxes", {
      userId: args.userId,
      requestedEmail: normalizeRequestedEmail(args.requestedEmail),
      inboxId: args.inboxId,
      podId: args.podId,
      clientId: args.clientId,
      createdAt: Date.now(),
    });
    return null;
  },
});

export const deleteInboxRecords = internalMutation({
  args: {
    userId: v.id("users"),
    inboxId: v.string(),
  },
  handler: async (ctx, args) => {
    const normalized = normalizeInboxIdentifier(args.inboxId);
    const docsByInboxId = await ctx.db
      .query("agentmailInboxes")
      .withIndex("by_user_id_and_inbox_id", (q) =>
        q.eq("userId", args.userId).eq("inboxId", normalized),
      )
      .collect();
    const docsByRequestedEmail = await ctx.db
      .query("agentmailInboxes")
      .withIndex("by_user_id_and_requested_email", (q) =>
        q.eq("userId", args.userId).eq("requestedEmail", normalized),
      )
      .collect();
    const deletedIds = new Set<string>();
    for (const doc of docsByInboxId) {
      await ctx.db.delete(doc._id);
      deletedIds.add(doc._id);
    }
    for (const doc of docsByRequestedEmail) {
      if (deletedIds.has(doc._id)) {
        continue;
      }
      await ctx.db.delete(doc._id);
      deletedIds.add(doc._id);
    }
    return {
      deletedLocalRecords: deletedIds.size,
    };
  },
});

export const createAgentmailInbox = internalAction({
  args: {
    userId: v.id("users"),
    requestedEmail: v.string(),
  },
  handler: async (ctx, args) => {
    const parsed = parseRequestedEmail(args.requestedEmail);
    const { baseUrl, apiKey } = getAgentmailConfig();

    const body: Record<string, string> = {
      username: parsed.username,
      client_id: buildClientId(args.userId, parsed.normalized),
    };
    if (parsed.domain !== null) {
      body.domain = parsed.domain;
    }

    const response = await fetch(`${baseUrl}/v0/inboxes`, {
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
        `AgentMail create inbox failed (${response.status}): ${rawBody.slice(0, 300)}`,
      );
    }
    const decoded = JSON.parse(rawBody) as AgentmailCreateInboxResponse;
    if (typeof decoded.inbox_id !== "string" || typeof decoded.pod_id !== "string") {
      throw new Error("AgentMail response did not include inbox_id/pod_id");
    }
    const resolvedEmail =
      typeof decoded.email === "string" ? decoded.email : decoded.inbox_id;
    const clientId =
      typeof decoded.client_id === "string" ? decoded.client_id : null;

    await ctx.runMutation(internal.agentmail.recordInbox, {
      userId: args.userId,
      requestedEmail: parsed.normalized,
      inboxId: decoded.inbox_id,
      podId: decoded.pod_id,
      clientId,
    });

    return {
      inboxId: decoded.inbox_id,
      email: resolvedEmail,
      podId: decoded.pod_id,
      clientId,
    };
  },
});

export const deleteAgentmailInbox = internalAction({
  args: {
    userId: v.id("users"),
    inboxId: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true; inboxId: string; deletedLocalRecords: number }> => {
    const inboxId = normalizeInboxIdentifier(args.inboxId);
    const { baseUrl, apiKey } = getAgentmailConfig();
    const response = await fetch(
      `${baseUrl}/v0/inboxes/${encodeURIComponent(inboxId)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );
    const rawBody = await response.text();
    if (!response.ok) {
      throw new Error(
        `AgentMail delete inbox failed (${response.status}): ${rawBody.slice(0, 300)}`,
      );
    }
    if (rawBody.trim().length > 0) {
      const parsed = JSON.parse(rawBody) as AgentmailDeleteInboxResponse;
      if (
        Object.prototype.hasOwnProperty.call(parsed, "success") &&
        parsed.success !== true
      ) {
        throw new Error("AgentMail delete inbox returned success=false");
      }
    }

    const cleanup: { deletedLocalRecords: number } = await ctx.runMutation(
      internal.agentmail.deleteInboxRecords,
      {
        userId: args.userId,
        inboxId,
      },
    );

    return {
      ok: true,
      inboxId,
      deletedLocalRecords: cleanup.deletedLocalRecords,
    };
  },
});
