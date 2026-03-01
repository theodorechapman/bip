import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import {
  buildCliManifest,
  renderInstallScript,
  renderPublicCliScript,
  renderSkillMarkdown,
} from "./publicCliAssets";
import { PHASE1_OFFERINGS, PHASE1_POLICY_DEFAULTS } from "./offerings";

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

function getAdminToken(req: Request): string | null {
  const token = req.headers.get("x-admin-token");
  if (token === null) {
    return null;
  }
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isAdminTokenValid(req: Request): boolean {
  const expected = (process.env.ADMIN_CARD_WRITE_TOKEN ?? "").trim();
  if (expected.length === 0) {
    return false;
  }
  const provided = getAdminToken(req);
  return provided !== null && provided === expected;
}

function sanitizeLabel(label: string): string {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : "card";
}

type GiftcardMetadataValidation =
  | {
      ok: true;
      metadata: Record<string, unknown>;
    }
  | {
      ok: false;
      error: "invalid_giftcard_metadata";
      detail: string;
      missingFields: Array<string>;
      invalidFields: Array<string>;
};

function validateGiftcardPurchaseMetadata(value: unknown): GiftcardMetadataValidation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      ok: false,
      error: "invalid_giftcard_metadata",
      detail:
        "giftcard_purchase requires metadata object with brand, region, amountUsd, and providerDomain.",
      missingFields: ["brand", "region", "amountUsd", "providerDomain"],
      invalidFields: [],
    };
  }
  const metadata = value as Record<string, unknown>;
  const missingFields: Array<string> = [];
  const invalidFields: Array<string> = [];

  const brand = typeof metadata.brand === "string" ? metadata.brand.trim() : "";
  if (brand.length === 0) {
    missingFields.push("brand");
  }

  const region = typeof metadata.region === "string" ? metadata.region.trim() : "";
  if (region.length === 0) {
    missingFields.push("region");
  }

  const amountUsd = typeof metadata.amountUsd === "number" ? metadata.amountUsd : Number.NaN;
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    invalidFields.push("amountUsd");
  }

  const providerDomain =
    typeof metadata.providerDomain === "string"
      ? metadata.providerDomain.trim().toLowerCase()
      : "";
  const providerDomainOk = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(providerDomain);
  if (providerDomain.length === 0) {
    missingFields.push("providerDomain");
  } else if (!providerDomainOk) {
    invalidFields.push("providerDomain");
  }

  if (missingFields.length > 0 || invalidFields.length > 0) {
    return {
      ok: false,
      error: "invalid_giftcard_metadata",
      detail:
        "giftcard_purchase metadata invalid. Required: brand(string), region(string), amountUsd(number>0), providerDomain(domain).",
      missingFields,
      invalidFields,
    };
  }

  return {
    ok: true,
    metadata: {
      ...metadata,
      brand,
      region,
      amountUsd,
      providerDomain,
    },
  };
}

type ApiKeyPurchaseMetadataValidation =
  | {
      ok: true;
      metadata: {
        provider: string;
        targetProduct?: string;
        dryRun?: boolean;
        accountEmailMode: "agentmail" | "existing";
      };
    }
  | {
      ok: false;
      error: "invalid_api_key_purchase_metadata";
      detail: string;
      missingFields: Array<string>;
      invalidFields: Array<string>;
    };

function validateApiKeyPurchaseMetadata(value: unknown): ApiKeyPurchaseMetadataValidation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      ok: false,
      error: "invalid_api_key_purchase_metadata",
      detail:
        "api_key_purchase requires metadata object with provider(string) and accountEmailMode(agentmail|existing).",
      missingFields: ["provider", "accountEmailMode"],
      invalidFields: [],
    };
  }
  const metadata = value as Record<string, unknown>;
  const missingFields: Array<string> = [];
  const invalidFields: Array<string> = [];

  const provider = typeof metadata.provider === "string" ? metadata.provider.trim() : "";
  if (provider.length === 0) {
    missingFields.push("provider");
  }

  let targetProduct: string | undefined;
  if (metadata.targetProduct !== undefined) {
    if (typeof metadata.targetProduct !== "string" || metadata.targetProduct.trim().length === 0) {
      invalidFields.push("targetProduct");
    } else {
      targetProduct = metadata.targetProduct.trim();
    }
  }

  let dryRun: boolean | undefined;
  if (metadata.dryRun !== undefined) {
    if (typeof metadata.dryRun !== "boolean") {
      invalidFields.push("dryRun");
    } else {
      dryRun = metadata.dryRun;
    }
  }

  const accountEmailModeRaw =
    typeof metadata.accountEmailMode === "string"
      ? metadata.accountEmailMode.trim().toLowerCase()
      : "";
  if (accountEmailModeRaw.length === 0) {
    missingFields.push("accountEmailMode");
  } else if (accountEmailModeRaw !== "agentmail" && accountEmailModeRaw !== "existing") {
    invalidFields.push("accountEmailMode");
  }

  if (missingFields.length > 0 || invalidFields.length > 0) {
    return {
      ok: false,
      error: "invalid_api_key_purchase_metadata",
      detail:
        "api_key_purchase metadata invalid. Required: provider(string), accountEmailMode(agentmail|existing). Optional: targetProduct(string), dryRun(boolean).",
      missingFields,
      invalidFields,
    };
  }

  return {
    ok: true,
    metadata: {
      provider,
      accountEmailMode: accountEmailModeRaw as "agentmail" | "existing",
      ...(targetProduct !== undefined ? { targetProduct } : {}),
      ...(dryRun !== undefined ? { dryRun } : {}),
    },
  };
}

function randomHex(bytes: number): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
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
  path: "/skill.md",
  method: "GET",
  handler: httpAction(async (_ctx, req) => {
    const origin = getRequestOrigin(req);
    return text(200, renderSkillMarkdown(origin), "text/markdown; charset=utf-8");
  }),
});

http.route({
  path: "/auth/login",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const authBypassRaw = (process.env.AUTH_BYPASS ?? "true").trim().toLowerCase();
      const authBypass = authBypassRaw !== "false";
      const body = await req.json().catch(() => ({}));
      const payload = body as { captchaToken?: unknown; inviteCode?: unknown };

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

      if (!authBypass) {
        if (
          typeof payload.captchaToken !== "string" ||
          typeof payload.inviteCode !== "string"
        ) {
          return json(400, { error: "captchaToken and inviteCode are required" });
        }
        const inviteCodes = getConfiguredInviteCodes();
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
      }

      const result = await ctx.runMutation(internal.auth.startLogin, {
        agentId,
      });
      return json(200, {
        ...result,
        authBypass,
      });
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
  path: "/api/tools/treasury_card_add",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const auth = await authenticateToolCall(ctx, req, "treasury_card_add");
      if (!auth.ok) return auth.response;
      if (!isAdminTokenValid(req)) {
        return json(403, { error: "Invalid or missing x-admin-token" });
      }
      const body = await req.json();
      const payload = body as {
        label?: unknown;
        pan?: unknown;
        expMonth?: unknown;
        expYear?: unknown;
        cvv?: unknown;
        nameOnCard?: unknown;
        billingZip?: unknown;
      };
      if (
        typeof payload.label !== "string" ||
        typeof payload.pan !== "string" ||
        typeof payload.expMonth !== "string" ||
        typeof payload.expYear !== "string" ||
        typeof payload.cvv !== "string" ||
        typeof payload.nameOnCard !== "string"
      ) {
        return json(400, {
          error:
            "label, pan, expMonth, expYear, cvv, and nameOnCard are required strings",
        });
      }
      const label = payload.label.trim();
      const pan = payload.pan.replace(/\s+/g, "");
      const expMonth = payload.expMonth.trim();
      const expYear = payload.expYear.trim();
      const cvv = payload.cvv.trim();
      const nameOnCard = payload.nameOnCard.trim();
      const billingZip =
        typeof payload.billingZip === "string" && payload.billingZip.trim().length > 0
          ? payload.billingZip.trim()
          : null;
      if (
        label.length === 0 ||
        pan.length < 12 ||
        expMonth.length === 0 ||
        expYear.length === 0 ||
        cvv.length < 3 ||
        nameOnCard.length === 0
      ) {
        return json(400, { error: "Invalid treasury card payload" });
      }
      const suffix = randomHex(6);
      const cardRef = `card_${sanitizeLabel(label)}_${suffix}`;
      const secretValue = JSON.stringify({
        label,
        pan,
        expMonth,
        expYear,
        cvv,
        nameOnCard,
        billingZip,
        last4: pan.slice(-4),
        status: "active",
      });
      const payments: any = (internal as any).payments;
      await ctx.runMutation(payments._putSecret, {
        secretRef: cardRef,
        userId: auth.session.userId,
        provider: "treasury",
        secretType: "treasury_card",
        secretValue,
      });
      return json(200, { ok: true, cardRef, label });
    } catch (error) {
      return json(400, { error: errorToMessage(error) });
    }
  }),
});

http.route({
  path: "/api/tools/treasury_card_list",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const auth = await authenticateToolCall(ctx, req, "treasury_card_list");
      if (!auth.ok) return auth.response;
      if (!isAdminTokenValid(req)) {
        return json(403, { error: "Invalid or missing x-admin-token" });
      }
      const payments: any = (internal as any).payments;
      const cards = await ctx.runQuery(payments.listTreasuryCards, {});
      return json(200, { ok: true, cards });
    } catch (error) {
      return json(400, { error: errorToMessage(error) });
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
  path: "/api/tools/wallet_deposit_address",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const auth = await authenticateToolCall(ctx, req, "wallet_deposit_address");
      if (!auth.ok) return auth.response;
      const chain = "solana";
      const payments: any = (internal as any).payments;
      let wallet = await ctx.runQuery(payments.getLatestWallet, {
        userId: auth.session.userId,
        chain,
      });
      if (wallet === null) {
        await ctx.runMutation(payments.generateWallet, {
          userId: auth.session.userId,
          chain,
          label: "primary",
        });
        wallet = await ctx.runQuery(payments.getLatestWallet, {
          userId: auth.session.userId,
          chain,
        });
      }
      if (wallet === null) {
        return json(500, { error: "Failed to provision wallet" });
      }
      const reference = `fund_${auth.session.userId}_${Date.now()}`;
      return json(200, {
        ok: true,
        chain,
        address: wallet.address,
        memo: reference,
        reference,
      });
    } catch (error) {
      return json(400, { error: errorToMessage(error) });
    }
  }),
});


http.route({
  path: "/api/tools/wallet_generate",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const auth = await authenticateToolCall(ctx, req, "wallet_generate");
      if (!auth.ok) return auth.response;
      const body = await req.json().catch(() => ({}));
      const payload = body as { chain?: unknown; label?: unknown };
      const chain = typeof payload.chain === "string" ? payload.chain : "solana";
      const out = await ctx.runMutation(internal.payments.generateWallet, {
        userId: auth.session.userId,
        chain,
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
      const account = await ctx.runQuery(internal.payments._getAccount, {
        userId: auth.session.userId,
      });
      return json(200, { chain, wallet, account });
    } catch (error) {
      return json(400, { error: errorToMessage(error) });
    }
  }),
});



http.route({
  path: "/api/tools/wallet_transfer",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const auth = await authenticateToolCall(ctx, req, "wallet_transfer");
      if (!auth.ok) return auth.response;
      const body = await req.json();
      const payload = body as { fromAddress?: unknown; toAddress?: unknown; amountSol?: unknown };
      if (typeof payload.fromAddress !== "string" || typeof payload.toAddress !== "string" || typeof payload.amountSol !== "number") {
        return json(400, { error: "fromAddress, toAddress, amountSol are required" });
      }
      const out = await ctx.runAction(internal.payments.transferSolBetweenWallets, {
        userId: auth.session.userId,
        fromAddress: payload.fromAddress,
        toAddress: payload.toAddress,
        amountSol: payload.amountSol,
      });
      return json(200, out);
    } catch (error) {
      return json(400, { error: errorToMessage(error) });
    }
  }),
});

http.route({
  path: "/api/tools/wallet_deposit",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const auth = await authenticateToolCall(ctx, req, "wallet_deposit");
      if (!auth.ok) return auth.response;
      const body = await req.json();
      const payload = body as { amountCents?: unknown; refType?: unknown; refId?: unknown };
      if (typeof payload.amountCents !== "number" || payload.amountCents <= 0) {
        return json(400, { error: "amountCents must be a positive number" });
      }
      const out = await ctx.runMutation(internal.payments._creditUserFunds, {
        userId: auth.session.userId,
        amountCents: Math.round(payload.amountCents),
        refType: typeof payload.refType === "string" ? payload.refType : undefined,
        refId: typeof payload.refId === "string" ? payload.refId : undefined,
      });
      return json(200, out);
    } catch (error) {
      return json(400, { error: errorToMessage(error) });
    }
  }),
});


http.route({
  path: "/api/tools/agent_bootstrap",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const auth = await authenticateToolCall(ctx, req, "agent_bootstrap");
      if (!auth.ok) return auth.response;
      const body = await req.json().catch(() => ({}));
      const payload = body as { emailPrefix?: unknown; chain?: unknown };
      const chain = typeof payload.chain === "string" ? payload.chain : "solana";

      // best-effort agentmail provisioning
      let inbox: unknown = null;
      const email = `${typeof payload.emailPrefix === "string" && payload.emailPrefix.length > 0 ? payload.emailPrefix : auth.session.agentId}@agentmail.local`;
      try {
        inbox = await ctx.runAction(internal.agentmail.createAgentmailInbox, {
          userId: auth.session.userId,
          requestedEmail: email,
        });
      } catch (_e) {
        inbox = { ok: false, error: "agentmail_unavailable" };
      }

      const wallet = await ctx.runMutation(internal.payments.generateWallet, {
        userId: auth.session.userId,
        chain,
        label: "bootstrap",
      });

      return json(200, {
        ok: true,
        agentId: auth.session.agentId,
        userId: auth.session.userId,
        inbox,
        wallet,
      });
    } catch (error) {
      return json(400, { error: errorToMessage(error) });
    }
  }),
});

http.route({
  path: "/api/tools/intent_resume",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const auth = await authenticateToolCall(ctx, req, "intent_resume");
      if (!auth.ok) return auth.response;
      const body = await req.json();
      const payload = body as { intentId?: unknown; browserUseApiKey?: unknown };
      if (typeof payload.intentId !== "string") return json(400, { error: "intentId is required" });
      const idempotencyKey = (req.headers.get("x-idempotency-key") ?? "").trim();
      if (!idempotencyKey) return json(400, { error: "x-idempotency-key header is required" });
      const intent = await ctx.runQuery(internal.payments.getIntent, { intentId: payload.intentId });
      if (intent === null || intent.userId !== auth.session.userId) return json(404, { error: "intent not found" });
      const out = await ctx.runAction(internal.payments.executeIntent, {
        intentId: payload.intentId,
        apiKey:
          (typeof payload.browserUseApiKey === "string" ? payload.browserUseApiKey.trim() : "") ||
          (req.headers.get("x-browser-use-api-key") ?? "").trim() ||
          (process.env.BROWSER_USE_API_KEY ?? "").trim() ||
          undefined,
      });
      return json(200, out);
    } catch (error) {
      return json(400, { error: errorToMessage(error) });
    }
  }),
});

http.route({
  path: "/api/tools/secrets_get",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const auth = await authenticateToolCall(ctx, req, "secrets_get");
      if (!auth.ok) return auth.response;
      const body = await req.json();
      const payload = body as { secretRef?: unknown };
      if (typeof payload.secretRef !== "string") return json(400, { error: "secretRef is required" });
      const row = await ctx.runQuery(internal.payments._getSecretForUser, {
        userId: auth.session.userId,
        secretRef: payload.secretRef,
      });
      if (row === null) return json(404, { error: "secret not found" });
      return json(200, {
        secretRef: row.secretRef,
        provider: row.provider ?? null,
        secretType: row.secretType,
        // keep explicit so caller knows this is sensitive output
        secretValue: row.secretValue,
      });
    } catch (error) {
      return json(400, { error: errorToMessage(error) });
    }
  }),
});

http.route({
  path: "/api/tools/offering_list",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const auth = await authenticateToolCall(ctx, req, "offering_list");
      if (!auth.ok) return auth.response;
      const payments: any = (internal as any).payments;
      await ctx.runMutation(payments.seedPhase1OfferingPolicies, {});
      const rows = await ctx.runQuery(payments.listOfferingPolicies, {});
      const byOfferingId = new Map<string, any>(
        (rows as Array<any>).map((row) => [row.offeringId, row]),
      );
      const offerings = PHASE1_OFFERINGS.map((offering) => {
        const defaultPolicy = PHASE1_POLICY_DEFAULTS.find(
          (item) => item.offeringId === offering.offeringId,
        );
        const persisted = byOfferingId.get(offering.offeringId);
        const policy = persisted ?? defaultPolicy ?? null;
        return {
          ...offering,
          policy:
            policy === null
              ? null
              : {
                  enabled: Boolean(policy.enabled),
                  providerAllowlist: policy.providerAllowlist,
                  maxBudgetCentsPerIntent: policy.maxBudgetCentsPerIntent,
                  maxBudgetCentsPerDay: policy.maxBudgetCentsPerDay,
                },
        };
      });
      return json(200, { offerings });
    } catch (error) {
      return json(400, { error: errorToMessage(error) });
    }
  }),
});

http.route({
  path: "/api/tools/funding_sync",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const auth = await authenticateToolCall(ctx, req, "funding_sync");
      if (!auth.ok) return auth.response;
      const body = await req.json().catch(() => ({}));
      const payload = body as { agentId?: unknown; maxTx?: unknown };
      if (payload.agentId !== undefined && typeof payload.agentId !== "string") {
        return json(400, { error: "agentId must be a string when provided" });
      }
      if (payload.maxTx !== undefined && typeof payload.maxTx !== "number") {
        return json(400, { error: "maxTx must be a number when provided" });
      }

      const payments: any = (internal as any).payments;
      let target = {
        userId: auth.session.userId,
        agentId: auth.session.agentId,
      };
      if (typeof payload.agentId === "string" && payload.agentId.trim().length > 0) {
        const resolved = await ctx.runQuery(payments.resolveUserIdOrAgentId, {
          userIdOrAgentId: payload.agentId,
        });
        if (resolved === null) {
          return json(404, { error: "user not found" });
        }
        target = resolved;
      }

      const out = await ctx.runAction(payments.syncSolanaFundingForUser, {
        userId: target.userId,
        maxTx: payload.maxTx,
      });
      return json(200, {
        ...out,
        userId: target.userId,
        agentId: target.agentId,
        triggeredByAgentId: auth.session.agentId,
        hardeningNote:
          typeof payload.agentId === "string" && payload.agentId.trim().length > 0
            ? "TODO: restrict agentId override to operator/admin role."
            : undefined,
      });
    } catch (error) {
      return json(400, { error: errorToMessage(error) });
    }
  }),
});

http.route({
  path: "/api/tools/funding_status",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const auth = await authenticateToolCall(ctx, req, "funding_status");
      if (!auth.ok) return auth.response;
      const body = await req.json().catch(() => ({}));
      const payload = body as { maxTx?: unknown };
      if (payload.maxTx !== undefined && typeof payload.maxTx !== "number") {
        return json(400, { error: "maxTx must be a number when provided" });
      }
      const payments: any = (internal as any).payments;
      const out = await ctx.runAction(payments.getSolanaFundingStatus, {
        userId: auth.session.userId,
        maxTx: payload.maxTx,
      });
      return json(200, {
        ...out,
        userId: auth.session.userId,
        agentId: auth.session.agentId,
      });
    } catch (error) {
      return json(400, { error: errorToMessage(error) });
    }
  }),
});

http.route({
  path: "/api/tools/funding_mark_settled",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const auth = await authenticateToolCall(ctx, req, "funding_mark_settled");
      if (!auth.ok) return auth.response;
      if (!isAdminTokenValid(req)) {
        return json(403, { error: "Invalid or missing x-admin-token" });
      }
      const body = await req.json();
      const payload = body as {
        userIdOrAgentId?: unknown;
        amountCents?: unknown;
        txSig?: unknown;
        chain?: unknown;
      };
      if (
        typeof payload.userIdOrAgentId !== "string" ||
        typeof payload.amountCents !== "number" ||
        typeof payload.txSig !== "string" ||
        payload.chain !== "solana"
      ) {
        return json(400, {
          error:
            "userIdOrAgentId, amountCents, txSig, and chain='solana' are required",
        });
      }
      if (payload.amountCents <= 0) {
        return json(400, { error: "amountCents must be a positive number" });
      }
      const payments: any = (internal as any).payments;
      const user = await ctx.runQuery(payments.resolveUserIdOrAgentId, {
        userIdOrAgentId: payload.userIdOrAgentId,
      });
      if (user === null) {
        return json(404, { error: "user not found" });
      }
      const out = await ctx.runMutation(payments._creditUserFunds, {
        userId: user.userId,
        amountCents: Math.round(payload.amountCents),
        refType: "solana_settled",
        refId: payload.txSig,
      });
      return json(200, {
        ok: true,
        userId: user.userId,
        agentId: user.agentId,
        chain: "solana",
        txSig: payload.txSig,
        ...out,
      });
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
      const payload = body as {
        task?: unknown;
        budgetUsd?: unknown;
        rail?: unknown;
        intentType?: unknown;
        provider?: unknown;
        metadata?: unknown;
      };
      if (typeof payload.task !== "string") return json(400, { error: "task is required" });
      const budgetUsd = typeof payload.budgetUsd === "number" ? payload.budgetUsd : 5;
      const rail = typeof payload.rail === "string" ? payload.rail : "auto";
      const intentType = typeof payload.intentType === "string" ? payload.intentType : undefined;
      const provider = typeof payload.provider === "string" ? payload.provider : undefined;
      let metadataValue: unknown = payload.metadata;
      const isGiftcardPurchase = (intentType ?? "").trim().toLowerCase() === "giftcard_purchase";
      const isApiKeyPurchase = (intentType ?? "").trim().toLowerCase() === "api_key_purchase";
      if (isGiftcardPurchase) {
        const metadataRecord =
          typeof metadataValue === "object" && metadataValue !== null && !Array.isArray(metadataValue)
            ? (metadataValue as Record<string, unknown>)
            : null;
        const existingCardRef =
          typeof metadataRecord?.cardRef === "string" ? metadataRecord.cardRef.trim() : "";
        if (existingCardRef.length === 0) {
          const defaultCardRef = (process.env.DEFAULT_TREASURY_CARD_REF ?? "").trim();
          if (defaultCardRef.length > 0) {
            metadataValue = {
              ...(metadataRecord ?? {}),
              cardRef: defaultCardRef,
            };
          }
        }
        const validation = validateGiftcardPurchaseMetadata(metadataValue);
        if (!validation.ok) {
          return json(400, validation);
        }
        metadataValue = validation.metadata;
      }
      if (isApiKeyPurchase) {
        const validation = validateApiKeyPurchaseMetadata(metadataValue);
        if (!validation.ok) {
          return json(400, validation);
        }
        if (provider && provider.trim().toLowerCase() !== validation.metadata.provider.toLowerCase()) {
          return json(400, {
            error: "metadata_provider_mismatch",
            detail: "metadata.provider must match top-level provider",
          });
        }
        metadataValue = validation.metadata;
      }
      const metadataJson = metadataValue !== undefined ? JSON.stringify(metadataValue) : undefined;
      let offeringId: string | undefined;

      const payments: any = (internal as any).payments;
      await ctx.runMutation(payments.seedPhase1OfferingPolicies, {});

      const hasIntentType = intentType !== undefined && intentType.trim().length > 0;
      const hasProvider = provider !== undefined && provider.trim().length > 0;
      if (hasIntentType !== hasProvider) {
        return json(400, {
          error: "intentType_and_provider_must_be_provided_together",
          detail: "Provide both intentType and provider, or omit both for legacy mode.",
        });
      }
      if (hasIntentType && hasProvider) {
        const validation = await ctx.runQuery(payments.validateIntentAgainstPolicy, {
          userId: auth.session.userId,
          intentType,
          provider,
          budgetUsd,
        });
        if (!validation.ok) {
          return json(403, validation);
        }
        offeringId = validation.offeringId;
      }

      const allowedProviders = ((process.env.ALLOWED_PROVIDERS ?? "bitrefill,namecheap,openrouter,elevenlabs").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean));
      if (provider && !allowedProviders.includes(provider.toLowerCase())) {
        return json(403, { error: "provider_not_allowed", provider, allowedProviders });
      }
      const out = await ctx.runMutation(payments.createIntent, {
        userId: auth.session.userId,
        task: payload.task,
        budgetUsd,
        rail,
        offeringId,
        intentType,
        provider,
        metadataJson,
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
      const payload = body as { intentId?: unknown; browserUseApiKey?: unknown };
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
      const payload = body as { intentId?: unknown; browserUseApiKey?: unknown };
      if (typeof payload.intentId !== "string") return json(400, { error: "intentId is required" });
      const intent = await ctx.runQuery(internal.payments.getIntent, { intentId: payload.intentId });
      if (intent === null || intent.userId !== auth.session.userId) {
        return json(404, { error: "intent not found" });
      }
      const apiKeyFromBody = typeof payload.browserUseApiKey === "string" ? payload.browserUseApiKey.trim() : "";
      const apiKeyFromHeader = (req.headers.get("x-browser-use-api-key") ?? "").trim();
      const out = await ctx.runAction(internal.payments.executeIntent, {
        intentId: payload.intentId,
        apiKey: apiKeyFromBody || apiKeyFromHeader || (process.env.BROWSER_USE_API_KEY ?? "").trim() || undefined,
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

http.route({
  path: "/api/tools/intent_status",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const auth = await authenticateToolCall(ctx, req, "intent_status");
      if (!auth.ok) return auth.response;
      const body = await req.json();
      const payload = body as { intentId?: unknown };
      if (typeof payload.intentId !== "string") return json(400, { error: "intentId is required" });
      const intent = await ctx.runQuery(internal.payments.getIntent, { intentId: payload.intentId });
      if (intent === null || intent.userId !== auth.session.userId) {
        return json(404, { error: "intent not found" });
      }
      const payments: any = (internal as any).payments;
      const events = await ctx.runQuery(payments.getIntentEvents, { intentId: payload.intentId });
      const funding = await ctx.runQuery(payments.getIntentFundingLifecycle, {
        userId: auth.session.userId,
        intentId: payload.intentId,
      });
      return json(200, { intent, events, ...funding });
    } catch (error) {
      return json(400, { error: errorToMessage(error) });
    }
  }),
});

http.route({
  path: "/api/tools/spend_summary",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const auth = await authenticateToolCall(ctx, req, "spend_summary");
      if (!auth.ok) return auth.response;
      const payments: any = (internal as any).payments;
      const summary = await ctx.runQuery(payments.getSpendSummary, {
        userId: auth.session.userId,
      });
      return json(200, summary);
    } catch (error) {
      return json(400, { error: errorToMessage(error) });
    }
  }),
});

export default http;
