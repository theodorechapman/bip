import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import {
  buildCliManifest,
  renderInstallScript,
  renderPublicCliScript,
} from "./publicCliAssets";

const http = httpRouter();
const DEFAULT_HCAPTCHA_VERIFY_URL = "https://api.hcaptcha.com/siteverify";

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function text(status: number, body: string, contentType: string): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=300",
    },
  });
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

function getRequestOrigin(req: Request): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

function getConfiguredInviteCodes(): Array<string> {
  const raw =
    process.env.INVITE_CODES?.trim() ?? process.env.INVITE_CODE?.trim() ?? "";
  if (raw.length === 0) {
    throw new Error("INVITE_CODES is not configured");
  }
  const codes = raw
    .split(/[,\s]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (codes.length === 0) {
    throw new Error("INVITE_CODES is not configured");
  }
  return codes;
}

function getAgentId(req: Request): string | null {
  const raw = req.headers.get("x-agent-id");
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed;
}

function getBearerToken(req: Request): string | null {
  const authorization = req.headers.get("authorization") ?? "";
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || token === undefined || token.length === 0) {
    return null;
  }
  return token;
}

type AuthedSession = {
  userId: Id<"users">;
  agentId: string;
  email: string | null;
  maxApiCalls: number;
  remainingApiCalls: number;
};

async function authenticateToolCall(
  ctx: any,
  req: Request,
  toolName: string,
): Promise<{ ok: true; session: AuthedSession } | { ok: false; response: Response }> {
  const token = getBearerToken(req);
  if (token === null) {
    return {
      ok: false,
      response: json(401, { error: "Missing bearer token" }),
    };
  }
  const session = await ctx.runMutation(internal.auth.consumeAccessTokenUse, {
    accessToken: token,
    toolName,
  });
  if (!session.ok) {
    if (session.reason === "quota_exceeded") {
      return {
        ok: false,
        response: json(429, { error: "Session API call quota exceeded" }),
      };
    }
    return {
      ok: false,
      response: json(401, { error: "Invalid or expired access token" }),
    };
  }
  return {
    ok: true,
    session: {
      userId: session.userId,
      agentId: session.agentId,
      email: session.email,
      maxApiCalls: session.maxApiCalls,
      remainingApiCalls: session.remainingApiCalls,
    },
  };
}

type HcaptchaVerifyResponse = {
  success?: boolean;
  challenge_ts?: string;
  hostname?: string;
  "error-codes"?: Array<string>;
};

function getClientIp(req: Request): string | null {
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp !== null && cfIp.trim().length > 0) {
    return cfIp.trim();
  }
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded !== null && forwarded.trim().length > 0) {
    const first = forwarded.split(",")[0]?.trim() ?? "";
    if (first.length > 0) {
      return first;
    }
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp !== null && realIp.trim().length > 0) {
    return realIp.trim();
  }
  return null;
}

async function verifyHcaptcha(
  captchaToken: string,
  remoteIp: string | null,
): Promise<{ ok: true } | { ok: false; errorCodes: Array<string> }> {
  const secret = process.env.HCAPTCHA_SECRET_KEY?.trim();
  if (secret === undefined || secret.length === 0) {
    throw new Error("HCAPTCHA_SECRET_KEY is not configured");
  }
  const siteKey = process.env.HCAPTCHA_SITE_KEY?.trim();
  const verifyUrl =
    process.env.HCAPTCHA_VERIFY_URL?.trim() ?? DEFAULT_HCAPTCHA_VERIFY_URL;
  const params = new URLSearchParams();
  params.set("secret", secret);
  params.set("response", captchaToken);
  if (siteKey !== undefined && siteKey.length > 0) {
    params.set("sitekey", siteKey);
  }
  if (remoteIp !== null) {
    params.set("remoteip", remoteIp);
  }
  const verificationResponse = await fetch(verifyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!verificationResponse.ok) {
    throw new Error(
      `hCaptcha verify request failed (${verificationResponse.status})`,
    );
  }
  const verificationBody =
    (await verificationResponse.json()) as HcaptchaVerifyResponse;
  if (verificationBody.success === true) {
    return { ok: true };
  }
  return {
    ok: false,
    errorCodes: verificationBody["error-codes"] ?? [],
  };
}

http.route({
  path: "/cli/manifest.json",
  method: "GET",
  handler: httpAction(async (_ctx, req) => {
    const origin = getRequestOrigin(req);
    return json(200, buildCliManifest(origin));
  }),
});

http.route({
  path: "/cli/install.sh",
  method: "GET",
  handler: httpAction(async (_ctx, req) => {
    const origin = getRequestOrigin(req);
    return text(200, renderInstallScript(origin), "text/x-shellscript; charset=utf-8");
  }),
});

http.route({
  path: "/cli/bip.mjs",
  method: "GET",
  handler: httpAction(async (_ctx, req) => {
    const origin = getRequestOrigin(req);
    return text(200, renderPublicCliScript(origin), "text/javascript; charset=utf-8");
  }),
});

http.route({
  path: "/auth/login",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const body = await req.json();
      const payload = body as { captchaToken?: unknown; inviteCode?: unknown };
      if (
        typeof payload.captchaToken !== "string" ||
        typeof payload.inviteCode !== "string"
      ) {
        return json(400, { error: "captchaToken and inviteCode are required" });
      }
      const inviteCodes = getConfiguredInviteCodes();
      const agentId = getAgentId(req);
      if (agentId === null) {
        return json(400, { error: "X-Agent-Id header is required" });
      }
      const ip = getClientIp(req) ?? "unknown";
      const loginRateLimit = await ctx.runQuery(internal.auth.checkRateLimit, {
        action: "login",
        subject: agentId,
        ip,
      });
      if (!loginRateLimit.allowed) {
        return json(429, {
          error: "Too many login attempts",
          reason: loginRateLimit.reason,
          retryAfterSeconds: loginRateLimit.retryAfterSeconds,
        });
      }
      await ctx.runMutation(internal.auth.recordAuthAttempt, {
        action: "login",
        subject: agentId,
        ip,
      });
      const captchaToken = payload.captchaToken.trim();
      if (captchaToken.length === 0) {
        return json(400, { error: "captchaToken must not be empty" });
      }
      const inviteCode = payload.inviteCode.trim();
      if (inviteCode.length === 0) {
        return json(400, { error: "inviteCode must not be empty" });
      }
      const captchaResult = await verifyHcaptcha(captchaToken, getClientIp(req));
      if (!captchaResult.ok) {
        return json(401, {
          error: "hCaptcha verification failed",
          errorCodes: captchaResult.errorCodes,
        });
      }
      if (!inviteCodes.includes(inviteCode)) {
        return json(403, { error: "Invalid invite code" });
      }
      const result = await ctx.runMutation(internal.auth.startLogin, {
        agentId,
      });
      return json(200, result);
    } catch (error) {
      const message = errorToMessage(error);
      if (message.includes("INVITE_CODES is not configured")) {
        return json(500, { error: message });
      }
      if (message.includes("HCAPTCHA_SECRET_KEY is not configured")) {
        return json(500, { error: message });
      }
      if (message.includes("hCaptcha verify request failed")) {
        return json(502, { error: message });
      }
      return json(400, { error: message });
    }
  }),
});

http.route({
  path: "/auth/logout",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const accessToken = getBearerToken(req);
      if (accessToken === null) {
        return json(401, { error: "Missing bearer token" });
      }
      const result = await ctx.runMutation(internal.auth.logoutSession, {
        accessToken,
      });
      return json(200, result);
    } catch (error) {
      return json(401, { error: errorToMessage(error) });
    }
  }),
});

http.route({
  path: "/api/tools/user_retrieve",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const auth = await authenticateToolCall(ctx, req, "user_retrieve");
      if (!auth.ok) {
        return auth.response;
      }
      return json(200, {
        id: auth.session.userId,
        email: auth.session.email,
        agentId: auth.session.agentId,
        maxApiCalls: auth.session.maxApiCalls,
        remainingApiCalls: auth.session.remainingApiCalls,
      });
    } catch (error) {
      return json(401, { error: errorToMessage(error) });
    }
  }),
});

http.route({
  path: "/api/tools/create_agentmail",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const auth = await authenticateToolCall(ctx, req, "create_agentmail");
      if (!auth.ok) {
        return auth.response;
      }
      const body = await req.json();
      const payload = body as { email?: unknown };
      if (typeof payload.email !== "string" || payload.email.trim().length === 0) {
        return json(400, { error: "email is required" });
      }
      const created = await ctx.runAction(internal.agentmail.createAgentmailInbox, {
        userId: auth.session.userId,
        requestedEmail: payload.email,
      });
      return json(200, {
        ...created,
        maxApiCalls: auth.session.maxApiCalls,
        remainingApiCalls: auth.session.remainingApiCalls,
      });
    } catch (error) {
      const message = errorToMessage(error);
      if (message.includes("AGENTMAIL_API_KEY is not configured")) {
        return json(500, { error: message });
      }
      return json(400, { error: message });
    }
  }),
});

http.route({
  path: "/api/tools/delete_agentmail",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const auth = await authenticateToolCall(ctx, req, "delete_agentmail");
      if (!auth.ok) {
        return auth.response;
      }
      const body = await req.json();
      const payload = body as { inboxId?: unknown };
      if (
        typeof payload.inboxId !== "string" ||
        payload.inboxId.trim().length === 0
      ) {
        return json(400, { error: "inboxId is required" });
      }
      const deleted = await ctx.runAction(internal.agentmail.deleteAgentmailInbox, {
        userId: auth.session.userId,
        inboxId: payload.inboxId,
      });
      return json(200, {
        ...deleted,
        maxApiCalls: auth.session.maxApiCalls,
        remainingApiCalls: auth.session.remainingApiCalls,
      });
    } catch (error) {
      const message = errorToMessage(error);
      if (message.includes("AGENTMAIL_API_KEY is not configured")) {
        return json(500, { error: message });
      }
      return json(400, { error: message });
    }
  }),
});

http.route({
  path: "/api/tools/register_wallet",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const auth = await authenticateToolCall(ctx, req, "register_wallet");
      if (!auth.ok) return auth.response;
      const body = await req.json();
      const payload = body as { chain?: unknown; address?: unknown; label?: unknown };
      if (typeof payload.chain !== "string" || typeof payload.address !== "string") {
        return json(400, { error: "chain and address are required" });
      }
      const out = await ctx.runMutation(internal.payments.registerWallet, {
        userId: auth.session.userId,
        chain: payload.chain,
        address: payload.address,
        label: typeof payload.label === "string" ? payload.label : undefined,
      });
      return json(200, out);
    } catch (error) {
      return json(400, { error: errorToMessage(error) });
    }
  }),
});

http.route({
  path: "/api/tools/wallet_balance",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const auth = await authenticateToolCall(ctx, req, "wallet_balance");
      if (!auth.ok) return auth.response;
      const body = await req.json();
      const payload = body as { chain?: unknown };
      const chain = typeof payload.chain === "string" ? payload.chain : "solana";
      const wallet = await ctx.runQuery(internal.payments.getLatestWallet, {
        userId: auth.session.userId,
        chain,
      });
      return json(200, { chain, wallet });
    } catch (error) {
      return json(400, { error: errorToMessage(error) });
    }
  }),
});

http.route({
  path: "/api/tools/create_intent",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const auth = await authenticateToolCall(ctx, req, "create_intent");
      if (!auth.ok) return auth.response;
      const body = await req.json();
      const payload = body as { task?: unknown; budgetUsd?: unknown; rail?: unknown };
      if (typeof payload.task !== "string") return json(400, { error: "task is required" });
      const budgetUsd = typeof payload.budgetUsd === "number" ? payload.budgetUsd : 5;
      const rail = typeof payload.rail === "string" ? payload.rail : "auto";
      const out = await ctx.runMutation(internal.payments.createIntent, {
        userId: auth.session.userId,
        task: payload.task,
        budgetUsd,
        rail,
      });
      return json(200, out);
    } catch (error) {
      return json(400, { error: errorToMessage(error) });
    }
  }),
});

http.route({
  path: "/api/tools/approve_intent",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const auth = await authenticateToolCall(ctx, req, "approve_intent");
      if (!auth.ok) return auth.response;
      const body = await req.json();
      const payload = body as { intentId?: unknown };
      if (typeof payload.intentId !== "string") return json(400, { error: "intentId is required" });
      const out = await ctx.runMutation(internal.payments.approveIntent, {
        intentId: payload.intentId,
        approvedBy: auth.session.agentId,
      });
      return json(200, out);
    } catch (error) {
      return json(400, { error: errorToMessage(error) });
    }
  }),
});

http.route({
  path: "/api/tools/execute_intent",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const auth = await authenticateToolCall(ctx, req, "execute_intent");
      if (!auth.ok) return auth.response;
      const body = await req.json();
      const payload = body as { intentId?: unknown };
      if (typeof payload.intentId !== "string") return json(400, { error: "intentId is required" });
      const intent = await ctx.runQuery(internal.payments.getIntent, { intentId: payload.intentId });
      if (intent === null || intent.userId !== auth.session.userId) {
        return json(404, { error: "intent not found" });
      }
      const out = await ctx.runAction(internal.payments.executeIntent, {
        intentId: payload.intentId,
      });
      return json(200, out);
    } catch (error) {
      return json(400, { error: errorToMessage(error) });
    }
  }),
});

http.route({
  path: "/api/tools/run_status",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const auth = await authenticateToolCall(ctx, req, "run_status");
      if (!auth.ok) return auth.response;
      const body = await req.json();
      const payload = body as { runId?: unknown };
      if (typeof payload.runId !== "string") return json(400, { error: "runId is required" });
      const run = await ctx.runQuery(internal.payments.getRun, { runId: payload.runId });
      if (run === null || run.userId !== auth.session.userId) {
        return json(404, { error: "run not found" });
      }
      return json(200, run);
    } catch (error) {
      return json(400, { error: errorToMessage(error) });
    }
  }),
});

export default http;
