import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

const ACCESS_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_API_CALL_LIMIT = 100;
const LOGIN_RATE_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_SUBJECT_LIMIT = 10;
const LOGIN_IP_LIMIT = 30;

function normalizeSubject(subject: string): string {
  return subject.trim().toLowerCase();
}

function normalizeIp(ip: string): string {
  const value = ip.trim();
  if (value.length === 0) {
    return "unknown";
  }
  return value;
}

function randomHex(bytes: number): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  return Array.from(view)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function countRecentAttempts(
  attempts: Array<{ createdAt: number }>,
  now: number,
  windowMs: number,
): number {
  let count = 0;
  for (const attempt of attempts) {
    if (now - attempt.createdAt <= windowMs) {
      count += 1;
    }
  }
  return count;
}

export const checkRateLimit = internalQuery({
  args: {
    action: v.literal("login"),
    subject: v.string(),
    ip: v.string(),
  },
  handler: async (ctx, args) => {
    const subject = normalizeSubject(args.subject);
    const ip = normalizeIp(args.ip);
    const now = Date.now();
    const subjectAttempts = await ctx.db
      .query("authAttempts")
      .withIndex("by_action_and_subject_and_created_at", (q) =>
        q.eq("action", args.action).eq("subject", subject),
      )
      .order("desc")
      .take(Math.max(LOGIN_SUBJECT_LIMIT * 3, 50));
    const subjectCount = countRecentAttempts(
      subjectAttempts,
      now,
      LOGIN_RATE_WINDOW_MS,
    );
    if (subjectCount >= LOGIN_SUBJECT_LIMIT) {
      return {
        allowed: false,
        reason: "subject_rate_limited",
        retryAfterSeconds: Math.ceil(LOGIN_RATE_WINDOW_MS / 1000),
      };
    }
    if (ip === "unknown") {
      return {
        allowed: true,
        reason: null,
        retryAfterSeconds: 0,
      };
    }
    const ipAttempts = await ctx.db
      .query("authAttempts")
      .withIndex("by_action_and_ip_and_created_at", (q) =>
        q.eq("action", args.action).eq("ip", ip),
      )
      .order("desc")
      .take(Math.max(LOGIN_IP_LIMIT * 3, 100));
    const ipCount = countRecentAttempts(ipAttempts, now, LOGIN_RATE_WINDOW_MS);
    if (ipCount >= LOGIN_IP_LIMIT) {
      return {
        allowed: false,
        reason: "ip_rate_limited",
        retryAfterSeconds: Math.ceil(LOGIN_RATE_WINDOW_MS / 1000),
      };
    }
    return {
      allowed: true,
      reason: null,
      retryAfterSeconds: 0,
    };
  },
});

export const recordAuthAttempt = internalMutation({
  args: {
    action: v.literal("login"),
    subject: v.string(),
    ip: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("authAttempts", {
      action: args.action,
      subject: normalizeSubject(args.subject),
      ip: normalizeIp(args.ip),
      createdAt: Date.now(),
    });
    return null;
  },
});

export const startLogin = internalMutation({
  args: {
    agentId: v.string(),
  },
  handler: async (ctx, args) => {
    const agentId = normalizeSubject(args.agentId);
    if (agentId.length < 3) {
      throw new Error("Invalid X-Agent-Id header");
    }

    const now = Date.now();
    let user = await ctx.db
      .query("users")
      .withIndex("by_agent_id", (q) => q.eq("agentId", agentId))
      .unique();
    if (user === null) {
      const userId = await ctx.db.insert("users", {
        agentId,
        email: null,
        createdAt: now,
      });
      const inserted = await ctx.db.get(userId);
      if (inserted === null) {
        throw new Error("Failed to create user");
      }
      user = inserted;
    }

    const accessToken = `at_${randomHex(32)}`;
    const tokenHash = await sha256Hex(accessToken);
    const accessExpiresAt = now + ACCESS_TTL_MS;

    await ctx.db.insert("accessSessions", {
      userId: user._id,
      tokenHash,
      expiresAt: accessExpiresAt,
      revokedAt: null,
      maxApiCalls: SESSION_API_CALL_LIMIT,
      usedApiCalls: 0,
      lastUsedAt: null,
      createdAt: now,
    });

    return {
      accessToken,
      expiresAt: Math.floor(accessExpiresAt / 1000),
      maxApiCalls: SESSION_API_CALL_LIMIT,
      remainingApiCalls: SESSION_API_CALL_LIMIT,
    };
  },
});

export const consumeAccessTokenUse = internalMutation({
  args: {
    accessToken: v.string(),
    toolName: v.string(),
  },
  handler: async (ctx, args) => {
    const accessToken = args.accessToken.trim();
    const toolName = args.toolName.trim();
    if (accessToken.length === 0) {
      return {
        ok: false,
        reason: "invalid_token",
      };
    }
    if (toolName.length === 0) {
      throw new Error("toolName is required");
    }

    const now = Date.now();
    const tokenHash = await sha256Hex(accessToken);
    const accessSession = await ctx.db
      .query("accessSessions")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (accessSession === null) {
      return {
        ok: false,
        reason: "invalid_token",
      };
    }
    if (accessSession.revokedAt !== null) {
      return {
        ok: false,
        reason: "revoked",
      };
    }
    if (accessSession.expiresAt < now) {
      return {
        ok: false,
        reason: "expired",
      };
    }
    if (accessSession.usedApiCalls >= accessSession.maxApiCalls) {
      return {
        ok: false,
        reason: "quota_exceeded",
      };
    }
    const user = await ctx.db.get(accessSession.userId);
    if (user === null) {
      return {
        ok: false,
        reason: "user_not_found",
      };
    }

    const nextUsed = accessSession.usedApiCalls + 1;
    await ctx.db.patch(accessSession._id, {
      usedApiCalls: nextUsed,
      lastUsedAt: now,
    });

    return {
      ok: true,
      userId: user._id,
      agentId: user.agentId,
      email: user.email,
      phone: user.phone ?? null,
      maxApiCalls: accessSession.maxApiCalls,
      remainingApiCalls: accessSession.maxApiCalls - nextUsed,
    };
  },
});

export const logoutSession = internalMutation({
  args: {
    accessToken: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const accessTokenHash = await sha256Hex(args.accessToken.trim());
    const accessSession = await ctx.db
      .query("accessSessions")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", accessTokenHash))
      .unique();
    if (accessSession === null) {
      return { ok: true };
    }
    if (accessSession.revokedAt === null) {
      await ctx.db.patch(accessSession._id, {
        revokedAt: now,
      });
    }
    return { ok: true };
  },
});
