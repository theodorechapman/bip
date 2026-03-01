import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
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
    const normalizedInboxId = normalizeInboxIdentifier(args.inboxId);
    await ctx.db.insert("agentmailInboxes", {
      userId: args.userId,
      requestedEmail: normalizeRequestedEmail(args.requestedEmail),
      inboxId: normalizedInboxId,
      podId: args.podId,
      clientId: args.clientId,
      createdAt: Date.now(),
    });
    return null;
  },
});

export const getActiveInbox = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("agentmailInboxes")
      .withIndex("by_user_id_and_created_at", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(1);
    const latest = docs[0] ?? null;
    if (latest === null) {
      return null;
    }
    return {
      inboxId: latest.inboxId,
      requestedEmail: latest.requestedEmail,
      podId: latest.podId,
      clientId: latest.clientId,
    };
  },
});

export const setUserEmail = internalMutation({
  args: {
    userId: v.id("users"),
    email: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (user === null) {
      throw new Error("User not found");
    }
    await ctx.db.patch(args.userId, {
      email: args.email === null ? null : normalizeRequestedEmail(args.email),
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
    const existingInbox = await ctx.runQuery(internal.agentmail.getActiveInbox, {
      userId: args.userId,
    });
    if (existingInbox !== null) {
      throw new Error(
        `Agent already has an active inbox (${existingInbox.inboxId}). Delete it before creating another.`,
      );
    }

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
    await ctx.runMutation(internal.agentmail.setUserEmail, {
      userId: args.userId,
      email: resolvedEmail,
    });

    // Register webhook for real-time email delivery (best-effort)
    const webhookUrl = (process.env.CONVEX_SITE_URL ?? "").trim();
    if (webhookUrl) {
      try {
        const webhookResp = await fetch(
          `${baseUrl}/v0/inboxes/${encodeURIComponent(decoded.inbox_id)}/webhooks`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              url: `${webhookUrl}/webhooks/agentmail`,
              events: ["message.received"],
            }),
          },
        );
        if (!webhookResp.ok) {
          const webhookBody = await webhookResp.text().catch(() => "");
          console.warn(
            `[agentmail] webhook registration failed (${webhookResp.status}): ${webhookBody.slice(0, 200)}`,
          );
        }
      } catch (err) {
        console.warn("[agentmail] webhook registration error:", err);
      }
    }

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
    const requestedInboxId = normalizeInboxIdentifier(args.inboxId);
    const activeInbox = await ctx.runQuery(internal.agentmail.getActiveInbox, {
      userId: args.userId,
    });
    if (activeInbox === null) {
      throw new Error("No active inbox to delete for this agent");
    }
    const activeInboxId = normalizeInboxIdentifier(activeInbox.inboxId);
    const activeRequestedEmail = normalizeRequestedEmail(activeInbox.requestedEmail);
    if (
      requestedInboxId !== activeInboxId &&
      requestedInboxId !== activeRequestedEmail
    ) {
      throw new Error("inboxId does not match this agent's active inbox");
    }

    const { baseUrl, apiKey } = getAgentmailConfig();
    const response = await fetch(
      `${baseUrl}/v0/inboxes/${encodeURIComponent(activeInboxId)}`,
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
        inboxId: activeInboxId,
      },
    );
    await ctx.runMutation(internal.agentmail.setUserEmail, {
      userId: args.userId,
      email: null,
    });

    return {
      ok: true,
      inboxId: activeInboxId,
      deletedLocalRecords: cleanup.deletedLocalRecords,
    };
  },
});

// ── Webhook handling ───────────────────────────────────────────────

export const recordWebhookMessage = internalMutation({
  args: {
    inboxId: v.string(),
    messageId: v.string(),
    fromAddress: v.union(v.string(), v.null()),
    subject: v.union(v.string(), v.null()),
    textBody: v.union(v.string(), v.null()),
    htmlBody: v.union(v.string(), v.null()),
    receivedAt: v.number(),
  },
  handler: async (ctx, args) => {
    // Deduplicate by messageId (indexed)
    const existing = await ctx.db
      .query("agentmailWebhookMessages")
      .withIndex("by_message_id", (q) => q.eq("messageId", args.messageId))
      .first();
    if (existing) {
      return { inserted: false, id: existing._id };
    }

    const id = await ctx.db.insert("agentmailWebhookMessages", {
      inboxId: args.inboxId,
      messageId: args.messageId,
      fromAddress: args.fromAddress,
      subject: args.subject,
      textBody: args.textBody,
      htmlBody: args.htmlBody,
      receivedAt: args.receivedAt,
      processed: false,
    });
    return { inserted: true, id };
  },
});

export const getUnprocessedMessages = internalQuery({
  args: {
    inboxId: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("agentmailWebhookMessages")
      .withIndex("by_inbox_id_and_processed", (q) =>
        q.eq("inboxId", args.inboxId).eq("processed", false),
      )
      .collect();
  },
});

export const markMessageProcessed = internalMutation({
  args: {
    messageId: v.id("agentmailWebhookMessages"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { processed: true });
  },
});

// ── Email reading helpers ──────────────────────────────────────────

type AgentmailMessage = {
  message_id: string;
  text?: string;
  html?: string;
  [key: string]: unknown;
};

function extractVerificationCode(message: AgentmailMessage): string | null {
  let body = message.text || message.html || "";
  // Strip HTML tags for cleaner matching
  body = body.replace(/<[^>]+>/g, " ");
  // Look for 4-8 digit codes — relaxed boundaries to catch codes after colons,
  // at line boundaries, etc.
  const match = body.match(/(?:^|\D)(\d{4,8})(?:\D|$)/);
  return match ? match[1] : null;
}

function extractVerificationLink(message: AgentmailMessage): string | null {
  let body = message.text || message.html || "";
  // Decode common HTML entities
  body = body
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  const patterns = [
    /https?:\/\/[^\s<>"]+(?:verify|confirm|activate|token|callback|auth)[^\s<>"]*/,
    /https?:\/\/[^\s<>"]+/,
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) return match[0];
  }
  return null;
}

export const getExistingMessageIds = internalAction({
  args: {
    inboxId: v.string(),
  },
  handler: async (_ctx, args): Promise<string[]> => {
    const { baseUrl, apiKey } = getAgentmailConfig();
    const response = await fetch(
      `${baseUrl}/v0/inboxes/${encodeURIComponent(args.inboxId)}/messages`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `AgentMail list messages failed (${response.status}): ${body.slice(0, 300)}`,
      );
    }
    const data = (await response.json()) as { messages?: AgentmailMessage[] };
    return (data.messages ?? []).map((m) => m.message_id);
  },
});

export const pollForVerificationEmail = internalAction({
  args: {
    inboxId: v.string(),
    knownMessageIds: v.array(v.string()),
    timeoutSeconds: v.optional(v.number()),
    pollIntervalSeconds: v.optional(v.number()),
  },
  handler: async (
    _ctx,
    args,
  ): Promise<{
    found: boolean;
    verificationLink: string | null;
    verificationCode: string | null;
    messageId: string | null;
    error: string | null;
  }> => {
    // Polling is now a fallback — the webhook handler (POST /webhooks/agentmail)
    // is the primary path for receiving emails in real-time. This poll runs at
    // longer intervals to catch anything the webhook might miss.
    const timeout = args.timeoutSeconds ?? 90;
    const pollInterval = args.pollIntervalSeconds ?? 15;
    const knownIds = new Set(args.knownMessageIds);
    const { baseUrl, apiKey } = getAgentmailConfig();
    const start = Date.now();

    while (Date.now() - start < timeout * 1000) {
      const response = await fetch(
        `${baseUrl}/v0/inboxes/${encodeURIComponent(args.inboxId)}/messages`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
        },
      );
      if (!response.ok) {
        return {
          found: false,
          verificationLink: null,
          verificationCode: null,
          messageId: null,
          error: `list messages failed (${response.status})`,
        };
      }
      const data = (await response.json()) as { messages?: AgentmailMessage[] };
      for (const msg of data.messages ?? []) {
        if (!knownIds.has(msg.message_id)) {
          // Fetch full message body
          const fullResp = await fetch(
            `${baseUrl}/v0/inboxes/${encodeURIComponent(args.inboxId)}/messages/${encodeURIComponent(msg.message_id)}`,
            {
              headers: { Authorization: `Bearer ${apiKey}` },
            },
          );
          if (!fullResp.ok) {
            return {
              found: true,
              verificationLink: null,
              verificationCode: null,
              messageId: msg.message_id,
              error: `fetch message failed (${fullResp.status})`,
            };
          }
          const fullMsg = (await fullResp.json()) as AgentmailMessage;
          const link = extractVerificationLink(fullMsg);
          const code = extractVerificationCode(fullMsg);
          return {
            found: true,
            verificationLink: link,
            verificationCode: code,
            messageId: msg.message_id,
            error: null,
          };
        }
      }

      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(`[agentmail] waiting for verification email... (${elapsed}s)`);
      await new Promise((resolve) => setTimeout(resolve, pollInterval * 1000));
    }

    return {
      found: false,
      verificationLink: null,
      verificationCode: null,
      messageId: null,
      error: `timed out after ${timeout}s`,
    };
  },
});
