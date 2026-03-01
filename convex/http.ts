import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import {
  buildCliManifest,
  renderHcaptchaPage,
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
  phone: string | null;
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
      phone: session.phone,
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
  path: "/cli/hcaptcha",
  method: "GET",
  handler: httpAction(async (_ctx, _req) => {
    const siteKey = process.env.HCAPTCHA_SITE_KEY?.trim();
    if (siteKey === undefined || siteKey.length === 0) {
      return text(
        500,
        "HCAPTCHA_SITE_KEY is not configured for this deployment.",
        "text/plain; charset=utf-8",
      );
    }
    return text(200, renderHcaptchaPage(siteKey), "text/html; charset=utf-8");
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
  path: "/auth/captcha-challenge",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const body = await req.json();
      const payload = body as { inviteCode?: unknown };
      if (typeof payload.inviteCode !== "string") {
        return json(400, { error: "inviteCode is required" });
      }
      const inviteCode = payload.inviteCode.trim();
      if (inviteCode.length === 0) {
        return json(400, { error: "inviteCode must not be empty" });
      }
      const inviteCodes = getConfiguredInviteCodes();
      if (!inviteCodes.includes(inviteCode)) {
        return json(403, { error: "Invalid invite code" });
      }
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
      const result = await ctx.runMutation(internal.auth.createCaptchaChallenge, {
        agentId,
        inviteCode,
        ip,
      });
      const origin = getRequestOrigin(req);
      return json(200, {
        challengeId: result.challengeId,
        captchaUrl: `${origin}/cli/hcaptcha?challenge=${result.challengeId}`,
      });
    } catch (error) {
      return json(400, { error: errorToMessage(error) });
    }
  }),
});

http.route({
  path: "/auth/captcha-callback",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const body = await req.json();
      const payload = body as { challengeId?: unknown; captchaToken?: unknown };
      if (typeof payload.challengeId !== "string" || typeof payload.captchaToken !== "string") {
        return json(400, { error: "challengeId and captchaToken are required" });
      }
      const challengeId = payload.challengeId.trim();
      const captchaToken = payload.captchaToken.trim();
      if (challengeId.length === 0 || captchaToken.length === 0) {
        return json(400, { error: "challengeId and captchaToken must not be empty" });
      }
      const challenge = await ctx.runQuery(internal.auth.getChallengeForCallback, {
        challengeId,
      });
      if (challenge === null) {
        return json(404, { error: "Challenge not found" });
      }
      if (challenge.status !== "pending") {
        return json(400, { error: "Challenge already completed" });
      }
      if (challenge.expiresAt < Date.now()) {
        return json(410, { error: "Challenge expired" });
      }
      await ctx.runMutation(internal.auth.recordAuthAttempt, {
        action: "login",
        subject: challenge.agentId,
        ip: challenge.ip,
      });
      const captchaResult = await verifyHcaptcha(captchaToken, challenge.ip);
      if (!captchaResult.ok) {
        return json(401, {
          error: "hCaptcha verification failed",
          errorCodes: captchaResult.errorCodes,
        });
      }
      const result = await ctx.runMutation(internal.auth.completeCaptchaChallenge, {
        challengeId,
      });
      if (!result.ok) {
        return json(400, { error: `Challenge failed: ${result.reason}` });
      }
      return json(200, { ok: true });
    } catch (error) {
      const message = errorToMessage(error);
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
  path: "/auth/captcha-poll",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const body = await req.json();
      const payload = body as { challengeId?: unknown };
      if (typeof payload.challengeId !== "string") {
        return json(400, { error: "challengeId is required" });
      }
      const result = await ctx.runQuery(internal.auth.pollCaptchaChallenge, {
        challengeId: payload.challengeId.trim(),
      });
      if (result.status === "not_found") {
        return json(404, { error: "Challenge not found" });
      }
      if (result.status === "expired") {
        return json(410, { error: "Challenge expired" });
      }
      if (result.status === "completed") {
        return json(200, {
          status: "completed",
          ...result.loginResult,
        });
      }
      return json(202, { status: "pending" });
    } catch (error) {
      return json(400, { error: errorToMessage(error) });
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
        phone: auth.session.phone,
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
  path: "/api/tools/rent_phone",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const auth = await authenticateToolCall(ctx, req, "rent_phone");
      if (!auth.ok) {
        return auth.response;
      }
      const body = await req.json();
      const payload = body as { areaCode?: unknown };
      const areaCode =
        typeof payload.areaCode === "string" && payload.areaCode.trim().length > 0
          ? payload.areaCode.trim()
          : undefined;

      const rented = await ctx.runAction(internal.joltsms.rentPhoneNumber, {
        userId: auth.session.userId,
        areaCode,
      });
      return json(200, {
        ...rented,
        maxApiCalls: auth.session.maxApiCalls,
        remainingApiCalls: auth.session.remainingApiCalls,
      });
    } catch (error) {
      const message = errorToMessage(error);
      if (message.includes("JOLTSMS_API_KEY is not configured")) {
        return json(500, { error: message });
      }
      return json(400, { error: message });
    }
  }),
});

http.route({
  path: "/api/tools/release_phone",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const auth = await authenticateToolCall(ctx, req, "release_phone");
      if (!auth.ok) {
        return auth.response;
      }
      const body = await req.json();
      const payload = body as { numberId?: unknown };
      if (
        typeof payload.numberId !== "string" ||
        payload.numberId.trim().length === 0
      ) {
        return json(400, { error: "numberId is required" });
      }
      const released = await ctx.runAction(internal.joltsms.releasePhoneNumber, {
        userId: auth.session.userId,
        numberId: payload.numberId,
      });
      return json(200, {
        ...released,
        maxApiCalls: auth.session.maxApiCalls,
        remainingApiCalls: auth.session.remainingApiCalls,
      });
    } catch (error) {
      const message = errorToMessage(error);
      if (message.includes("JOLTSMS_API_KEY is not configured")) {
        return json(500, { error: message });
      }
      return json(400, { error: message });
    }
  }),
});

export default http;
