import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();
const HCAPTCHA_VERIFY_URL = "https://api.hcaptcha.com/siteverify";

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
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
  const params = new URLSearchParams();
  params.set("secret", secret);
  params.set("response", captchaToken);
  if (siteKey !== undefined && siteKey.length > 0) {
    params.set("sitekey", siteKey);
  }
  if (remoteIp !== null) {
    params.set("remoteip", remoteIp);
  }
  const verificationResponse = await fetch(HCAPTCHA_VERIFY_URL, {
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
  path: "/auth/login",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const body = await req.json();
      const payload = body as { email?: unknown; captchaToken?: unknown };
      if (
        typeof payload.email !== "string" ||
        typeof payload.captchaToken !== "string"
      ) {
        return json(400, { error: "email and captchaToken are required" });
      }
      const captchaToken = payload.captchaToken.trim();
      if (captchaToken.length === 0) {
        return json(400, { error: "captchaToken must not be empty" });
      }
      const captchaResult = await verifyHcaptcha(captchaToken, getClientIp(req));
      if (!captchaResult.ok) {
        return json(401, {
          error: "hCaptcha verification failed",
          errorCodes: captchaResult.errorCodes,
        });
      }
      const result = await ctx.runMutation(internal.auth.startLogin, {
        email: payload.email,
      });
      return json(200, result);
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
  path: "/auth/verify",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const body = await req.json();
      const payload = body as { email?: unknown; code?: unknown };
      if (typeof payload.email !== "string" || typeof payload.code !== "string") {
        return json(400, { error: "email and code are required" });
      }
      const result = await ctx.runMutation(internal.auth.verifyLogin, {
        email: payload.email,
        code: payload.code,
      });
      return json(200, result);
    } catch (error) {
      return json(401, { error: errorToMessage(error) });
    }
  }),
});

http.route({
  path: "/auth/refresh",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const body = await req.json();
      const payload = body as { refreshToken?: unknown };
      if (typeof payload.refreshToken !== "string") {
        return json(400, { error: "refreshToken is required" });
      }
      const result = await ctx.runMutation(internal.auth.refreshAccess, {
        refreshToken: payload.refreshToken,
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
      const authorization = req.headers.get("authorization") ?? "";
      const [scheme, token] = authorization.split(" ");
      if (scheme?.toLowerCase() !== "bearer" || !token) {
        return json(401, { error: "Missing bearer token" });
      }
      const session = await ctx.runQuery(internal.auth.authenticateAccessToken, {
        accessToken: token,
      });
      if (session === null) {
        return json(401, { error: "Invalid or expired access token" });
      }
      return json(200, {
        id: session.userId,
        email: session.email,
      });
    } catch (error) {
      return json(401, { error: errorToMessage(error) });
    }
  }),
});

export default http;
