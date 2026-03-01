import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

const OTP_TTL_MS = 10 * 60 * 1000;
const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function randomInt(min: number, max: number): number {
  const span = max - min + 1;
  return Math.floor(Math.random() * span) + min;
}

function sixDigitCode(): string {
  const code = randomInt(0, 999999);
  return code.toString().padStart(6, "0");
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

async function issueTokenPair(): Promise<{
  accessToken: string;
  refreshToken: string;
  accessTokenHash: string;
  refreshTokenHash: string;
}> {
  const accessToken = `at_${randomHex(32)}`;
  const refreshToken = `rt_${randomHex(32)}`;
  const accessTokenHash = await sha256Hex(accessToken);
  const refreshTokenHash = await sha256Hex(refreshToken);
  return { accessToken, refreshToken, accessTokenHash, refreshTokenHash };
}

export const startLogin = internalMutation({
  args: {
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    if (!email.includes("@")) {
      throw new Error("Invalid email");
    }

    const now = Date.now();
    let user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (user === null) {
      const userId = await ctx.db.insert("users", {
        email,
        createdAt: now,
      });
      const inserted = await ctx.db.get(userId);
      if (inserted === null) {
        throw new Error("Failed to create user");
      }
      user = inserted;
    }

    const otpCode = sixDigitCode();
    const codeHash = await sha256Hex(otpCode);
    await ctx.db.insert("otpChallenges", {
      email,
      codeHash,
      expiresAt: now + OTP_TTL_MS,
      attempts: 0,
      maxAttempts: MAX_OTP_ATTEMPTS,
      usedAt: null,
      createdAt: now,
    });

    return {
      email,
      otpSent: true,
      expiresAt: now + OTP_TTL_MS,
      // Demo-only convenience so local CLI testing doesn't require real email delivery.
      debugCode: otpCode,
      userId: user._id,
    };
  },
});

export const verifyLogin = internalMutation({
  args: {
    email: v.string(),
    code: v.string(),
  },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    const code = args.code.trim();
    if (!/^\d{6}$/.test(code)) {
      throw new Error("Code must be 6 digits");
    }

    const now = Date.now();
    const challenges = await ctx.db
      .query("otpChallenges")
      .withIndex("by_email_and_created_at", (q) => q.eq("email", email))
      .order("desc")
      .take(5);
    const latestValidChallenge =
      challenges.find((challenge) => challenge.usedAt === null) ?? null;
    if (latestValidChallenge === null) {
      throw new Error("No active login challenge");
    }
    if (latestValidChallenge.expiresAt < now) {
      throw new Error("Verification code expired");
    }
    if (latestValidChallenge.attempts >= latestValidChallenge.maxAttempts) {
      throw new Error("Too many verification attempts");
    }

    const incomingHash = await sha256Hex(code);
    if (incomingHash !== latestValidChallenge.codeHash) {
      await ctx.db.patch(latestValidChallenge._id, {
        attempts: latestValidChallenge.attempts + 1,
      });
      throw new Error("Invalid verification code");
    }
    await ctx.db.patch(latestValidChallenge._id, {
      usedAt: now,
    });

    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (user === null) {
      throw new Error("User not found");
    }

    const pair = await issueTokenPair();
    const accessExpiresAt = now + ACCESS_TTL_MS;
    const refreshExpiresAt = now + REFRESH_TTL_MS;

    await ctx.db.insert("accessSessions", {
      userId: user._id,
      tokenHash: pair.accessTokenHash,
      expiresAt: accessExpiresAt,
      revokedAt: null,
      createdAt: now,
    });
    await ctx.db.insert("refreshSessions", {
      userId: user._id,
      tokenHash: pair.refreshTokenHash,
      expiresAt: refreshExpiresAt,
      revokedAt: null,
      replacedByTokenHash: null,
      createdAt: now,
    });

    return {
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      expiresAt: Math.floor(accessExpiresAt / 1000),
    };
  },
});

export const refreshAccess = internalMutation({
  args: {
    refreshToken: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const refreshTokenHash = await sha256Hex(args.refreshToken.trim());
    const refreshSession = await ctx.db
      .query("refreshSessions")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", refreshTokenHash))
      .unique();
    if (refreshSession === null) {
      throw new Error("Invalid refresh token");
    }
    if (refreshSession.revokedAt !== null) {
      throw new Error("Refresh token already revoked");
    }
    if (refreshSession.expiresAt < now) {
      throw new Error("Refresh token expired");
    }

    const pair = await issueTokenPair();
    const accessExpiresAt = now + ACCESS_TTL_MS;
    const refreshExpiresAt = now + REFRESH_TTL_MS;

    await ctx.db.patch(refreshSession._id, {
      revokedAt: now,
      replacedByTokenHash: pair.refreshTokenHash,
    });
    await ctx.db.insert("accessSessions", {
      userId: refreshSession.userId,
      tokenHash: pair.accessTokenHash,
      expiresAt: accessExpiresAt,
      revokedAt: null,
      createdAt: now,
    });
    await ctx.db.insert("refreshSessions", {
      userId: refreshSession.userId,
      tokenHash: pair.refreshTokenHash,
      expiresAt: refreshExpiresAt,
      revokedAt: null,
      replacedByTokenHash: null,
      createdAt: now,
    });

    return {
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      expiresAt: Math.floor(accessExpiresAt / 1000),
    };
  },
});

export const authenticateAccessToken = internalQuery({
  args: {
    accessToken: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const tokenHash = await sha256Hex(args.accessToken.trim());
    const accessSession = await ctx.db
      .query("accessSessions")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (accessSession === null) {
      return null;
    }
    if (accessSession.revokedAt !== null || accessSession.expiresAt < now) {
      return null;
    }
    const user = await ctx.db.get(accessSession.userId);
    if (user === null) {
      return null;
    }
    return {
      userId: user._id,
      email: user.email,
    };
  },
});
