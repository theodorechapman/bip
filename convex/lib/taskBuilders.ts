/**
 * Metadata parsing and browser-use task construction.
 * Pure functions — no convex exports.
 */

import { normalizeLower } from "../offerings";

// ── Types ──────────────────────────────────────────────────────────

export type GiftcardExecutionMetadata = {
  brand: string;
  region: string;
  amountUsd: number;
  providerDomain: string;
  dryRun: boolean;
};

export type ApiKeyPurchaseMetadata = {
  provider: string;
  accountEmailMode: "agentmail" | "existing";
  targetProduct?: string;
  dryRun?: boolean;
};

export type XAccountBootstrapMetadata = {
  profileName: string;
  handle?: string;
  bio?: string;
};

export type XPostMetadata = {
  postText: string;
  imageBase64?: string;
};

// ── Domain helpers ─────────────────────────────────────────────────

export function isValidDomain(value: string): boolean {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value);
}

export function domainMatchesProvider(candidateDomain: string, providerDomain: string): boolean {
  const candidate = candidateDomain.toLowerCase();
  const provider = providerDomain.toLowerCase();
  return candidate === provider || candidate.endsWith(`.${provider}`);
}

export function getApiKeyProviderDomain(providerRaw: string): string | null {
  const provider = normalizeLower(providerRaw);
  if (provider === "openrouter") return "openrouter.ai";
  if (provider === "elevenlabs") return "elevenlabs.io";
  return null;
}

// ── Metadata parsers ───────────────────────────────────────────────

export function parseGiftcardExecutionMetadata(meta: unknown): GiftcardExecutionMetadata | null {
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return null;
  const value = meta as Record<string, unknown>;
  const brand = typeof value.brand === "string" ? value.brand.trim() : "";
  const region = typeof value.region === "string" ? value.region.trim() : "";
  const amountUsd = typeof value.amountUsd === "number" ? value.amountUsd : Number.NaN;
  const providerDomain =
    typeof value.providerDomain === "string"
      ? value.providerDomain.trim().toLowerCase()
      : "";
  if (!brand || !region || !Number.isFinite(amountUsd) || amountUsd <= 0 || !providerDomain || !isValidDomain(providerDomain)) {
    return null;
  }
  const dryRun = value.dryRun === true;
  return {
    brand,
    region,
    amountUsd,
    providerDomain,
    dryRun,
  };
}

export function parseApiKeyPurchaseMetadata(value: unknown): ApiKeyPurchaseMetadata | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const metadata = value as Record<string, unknown>;
  const provider = typeof metadata.provider === "string" ? metadata.provider.trim() : "";
  const emailMode = typeof metadata.accountEmailMode === "string"
    ? metadata.accountEmailMode.trim().toLowerCase()
    : "";
  if (!provider || (emailMode !== "agentmail" && emailMode !== "existing")) return null;
  const targetProduct =
    typeof metadata.targetProduct === "string" && metadata.targetProduct.trim().length > 0
      ? metadata.targetProduct.trim()
      : undefined;
  const dryRun = typeof metadata.dryRun === "boolean" ? metadata.dryRun : undefined;
  return {
    provider,
    accountEmailMode: emailMode,
    ...(targetProduct !== undefined ? { targetProduct } : {}),
    ...(dryRun !== undefined ? { dryRun } : {}),
  };
}

export function parseXAccountBootstrapMetadata(value: unknown): XAccountBootstrapMetadata | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const metadata = value as Record<string, unknown>;
  const profileName = typeof metadata.profileName === "string" ? metadata.profileName.trim() : "";
  if (!profileName) return null;
  const handle =
    typeof metadata.handle === "string" && metadata.handle.trim().length > 0
      ? metadata.handle.trim()
      : undefined;
  const bio =
    typeof metadata.bio === "string" && metadata.bio.trim().length > 0
      ? metadata.bio.trim()
      : undefined;
  return { profileName, ...(handle ? { handle } : {}), ...(bio ? { bio } : {}) };
}

export function parseXPostMetadata(value: unknown): XPostMetadata | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const metadata = value as Record<string, unknown>;
  const postText = typeof metadata.postText === "string" ? metadata.postText.trim() : "";
  if (!postText) return null;
  const imageBase64 =
    typeof metadata.imageBase64 === "string" && metadata.imageBase64.length > 0
      ? metadata.imageBase64
      : undefined;
  return { postText, ...(imageBase64 ? { imageBase64 } : {}) };
}

// ── Task builders ──────────────────────────────────────────────────

export function buildDeterministicGiftcardTask(input: {
  originalTask: string;
  metadata: GiftcardExecutionMetadata;
  maxSteps: number;
  treasuryCardInstructions: string;
}): string {
  return [
    `[giftcard_purchase deterministic]`,
    `Primary objective: buy exactly ${input.metadata.brand} gift card for USD ${input.metadata.amountUsd} in region ${input.metadata.region}.`,
    `Provider domain: ${input.metadata.providerDomain}`,
    "",
    "Hard constraints:",
    `1. Start directly at https://${input.metadata.providerDomain}.`,
    "2. Do not use search engines or query aggregators.",
    "3. Do not click ads/sponsored links or alternate merchants.",
    `4. Buy the exact brand "${input.metadata.brand}" and amount ${input.metadata.amountUsd} USD only.`,
    `5. Never navigate outside ${input.metadata.providerDomain} or its subdomains.`,
    `6. Stop after at most ${input.maxSteps} steps.`,
    input.metadata.dryRun
      ? "7. DRY RUN: navigation/planning only. Reach checkout and stop before submitting payment."
      : "7. Complete purchase only if all constraints are satisfied.",
    "",
    "Stop conditions:",
    "- If off-domain navigation or search behavior is required, stop and report BLOCKED: off_domain_navigation.",
    "- If exact product/amount cannot be found on-provider, stop and report BLOCKED: exact_match_unavailable.",
    input.metadata.dryRun
      ? "- On reaching checkout page, return URL/title and cart summary; do not submit payment."
      : "- On completion, return redemption details and order confirmation proof.",
    "",
    `Original task context: ${input.originalTask}`,
    input.treasuryCardInstructions,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

export function buildApiKeyPurchaseTask(input: {
  provider: string;
  providerDomain: string;
  task: string;
  accountEmailMode: "agentmail" | "existing";
  targetProduct?: string;
}): string {
  const targetProductLine = input.targetProduct
    ? `Target product: ${input.targetProduct}`
    : "Target product: provider default API credits/subscription flow.";
  const emailVerificationNote =
    input.accountEmailMode === "agentmail"
      ? [
          "IMPORTANT email verification instructions:",
          "- After submitting the signup form, the site may ask you to verify your email.",
          "- Do NOT attempt to open the email inbox or navigate to agentmail.to — there is no web UI.",
          "- Email verification will be handled automatically via API after you finish.",
          "- If the site shows a 'verify your email' screen, simply report that signup was submitted and verification is pending.",
          "- Continue with as many remaining steps as possible (some may require verification first — that is OK, just report what happened).",
        ]
      : [];
  return [
    `[intent=api_key_purchase] [provider=${input.provider}] [domain=${input.providerDomain}]`,
    `Goal: ${input.task}`,
    "Deterministic constraints:",
    `- Navigate directly to https://${input.providerDomain} only.`,
    "- Do not use search engines, affiliate links, or off-domain merchants.",
    "- Stay on provider-owned pages for every step.",
    ...emailVerificationNote,
    "Execution steps:",
    "1) Signup/login on the provider site using the approved account path.",
    `   accountEmailMode=${input.accountEmailMode}`,
    `2) Open billing/credits on ${input.providerDomain}.`,
    `3) Complete credits/subscription purchase as needed. ${targetProductLine}`,
    "4) Open API keys page and create a new key.",
    "5) Capture proof: key creation page URL, timestamp, masked key prefix, and billing confirmation details.",
    "Output requirements:",
    "- Return created API key if visible.",
    "- Return proof bundle including URL/title/timestamp and a concise audit trail.",
  ].join("\n");
}

export function buildApiKeyResumeTask(input: {
  provider: string;
  providerDomain: string;
  targetProduct?: string;
  agentCredentialInstructions: string;
  treasuryCardInstructions: string;
}): string {
  const targetProductLine = input.targetProduct
    ? `Target product: ${input.targetProduct}`
    : "Target product: provider default API credits/subscription flow.";
  return [
    `[intent=api_key_purchase_resume] [provider=${input.provider}] [domain=${input.providerDomain}]`,
    "Your email has been verified. Now complete the remaining steps.",
    "Deterministic constraints:",
    `- Navigate directly to https://${input.providerDomain} only.`,
    "- Do not use search engines, affiliate links, or off-domain merchants.",
    "- Stay on provider-owned pages for every step.",
    "- Do NOT attempt to sign up again — the account already exists.",
    "Execution steps:",
    `1) Log into https://${input.providerDomain} using the credentials provided below.`,
    `2) Navigate to the billing/credits page on ${input.providerDomain}.`,
    `3) Add credits or subscribe as needed. ${targetProductLine}`,
    "4) Navigate to the API keys page and create a new key.",
    "5) Copy the full API key value.",
    "Output requirements:",
    "- Return the created API key value if visible.",
    "- Return proof bundle including URL/title/timestamp and a concise audit trail.",
    input.treasuryCardInstructions,
    input.agentCredentialInstructions,
  ].filter(Boolean).join("\n");
}

export function buildApiKeyDryRunPlan(input: {
  provider: string;
  providerDomain: string;
  accountEmailMode: "agentmail" | "existing";
  targetProduct?: string;
}): string {
  return [
    `Dry run plan for provider=${input.provider} (domain=${input.providerDomain})`,
    "1) Login/signup on provider domain only.",
    `2) Navigate to billing/credits and choose target product (${input.targetProduct ?? "provider default"}).`,
    "3) Navigate to API key management and create key.",
    "4) Capture proof artifacts (URL, timestamp, masked key prefix, billing receipt).",
    `5) Re-run execute_intent with metadata.dryRun=false (accountEmailMode=${input.accountEmailMode}).`,
  ].join("\n");
}

export function buildXAccountBootstrapTask(input: {
  profileName: string;
  handle?: string;
  bio?: string;
  agentCredentialInstructions: string;
}): string {
  const handleLine = input.handle
    ? `Requested handle: @${input.handle.replace(/^@/, "")}`
    : "Handle: let X auto-assign or choose something close to the display name.";
  const bioLine = input.bio ? `Additional: After account creation, set bio: "${input.bio}"` : "";
  return [
    "[intent=x_account_bootstrap] [provider=x] [domain=x.com]",
    `Goal: Create a new X/Twitter account with display name "${input.profileName}".`,
    handleLine,
    "Deterministic constraints:",
    "- Navigate directly to https://x.com only.",
    "- Do NOT use Google/Apple/GitHub OAuth — use email signup.",
    "- Do NOT navigate to agentmail.to — there is no web UI for the inbox.",
    "- Email verification is handled automatically via API after you finish.",
    "- If X asks for phone verification, try to skip it. If you cannot skip, report that phone verification is required.",
    "- Stay on x.com for every step.",
    "Execution steps:",
    "1) Navigate to https://x.com/i/flow/signup",
    "2) Select 'Create account' with email (not phone).",
    "3) Enter the display name and email address from the credentials below.",
    "4) Set the date of birth to a valid adult date (e.g., January 1, 1995).",
    "5) Complete signup form — agree to terms.",
    "6) If an Arkose Labs / FunCaptcha challenge appears, STOP immediately and report 'captcha_blocked' in your output. Do NOT try to solve it yourself. Include the current page URL in your output.",
    "7) When asked for email verification code, STOP and wait on the verification code input screen. Do NOT close, navigate away, or continue past this screen. The code will be entered automatically.",
    "8) Set the password from the credentials below.",
    "9) If prompted to set a handle/username, set the requested handle.",
    "10) Skip optional steps (profile photo, bio, interests) unless explicitly provided below.",
    "11) Report the final account handle and setup status.",
    bioLine,
    "Output requirements:",
    "- Return the X handle (e.g., @username) if successfully created.",
    "- Return setup status: 'complete', 'verification_pending', or 'phone_required'.",
    "- If any step failed, report which step and the error.",
    input.agentCredentialInstructions,
  ].filter(Boolean).join("\n");
}

export function buildXPostTask(input: {
  postText: string;
  imageBase64?: string;
  agentCredentialInstructions: string;
}): string {
  const imageNote = input.imageBase64
    ? "An image has been provided — upload it with the post."
    : "No image to attach — text-only post.";
  return [
    "[intent=x_post] [provider=x] [domain=x.com]",
    "Goal: Post a tweet on X/Twitter.",
    "Deterministic constraints:",
    "- Navigate directly to https://x.com only.",
    "- Do NOT use search engines or external sites.",
    "- Stay on x.com for every step.",
    "- If a CAPTCHA or verification appears, attempt to solve it. If blocked, report the issue.",
    "Execution steps:",
    "1) Navigate to https://x.com/home",
    "2) If not logged in, click 'Sign in' and log in with the credentials below.",
    "3) Click the compose/post button (the 'Post' or '+' button).",
    "4) Enter the post text provided below.",
    "5) If an image is provided, click the image/media upload button and upload it.",
    "6) Click 'Post' to submit.",
    "7) Wait for the post to appear in the timeline.",
    "8) Return the URL of the posted tweet.",
    `Post text:\n---\n${input.postText}\n---`,
    imageNote,
    "Output requirements:",
    "- Return the full URL of the posted tweet (e.g., https://x.com/username/status/123456).",
    "- If posting failed, report the error and what step it failed on.",
    input.agentCredentialInstructions,
  ].join("\n");
}

// ── Output analysis helpers ────────────────────────────────────────

export function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? "");
  }
}

export function detectOffDomainNavigation(
  output: unknown,
  raw: unknown,
  providerDomain: string,
): { reason: string; evidence: string } | null {
  const text = `${stringifyUnknown(output)}\n${stringifyUnknown(raw)}`.toLowerCase();
  const searchPatterns = [
    /\bgoogle\./,
    /\bbing\./,
    /\bduckduckgo\./,
    /\byahoo\./,
    /\bsearch result/,
    /\bused search/,
    /\bsearch engine/,
  ];
  if (searchPatterns.some((pattern) => pattern.test(text))) {
    return {
      reason: "search_engine_navigation_detected",
      evidence: "BrowserUse output indicates search engine usage.",
    };
  }

  const domainMatches = text.match(/\b([a-z0-9-]+\.)+[a-z]{2,}\b/g) ?? [];
  const uniqueDomains = new Set(domainMatches.map((value) => value.toLowerCase()));
  const ignoredDomains = new Set(["browser-use.com", "cloud.browser-use.com"]);
  for (const domain of uniqueDomains) {
    if (ignoredDomains.has(domain)) continue;
    if (domainMatchesProvider(domain, providerDomain)) continue;
    return {
      reason: "alternate_domain_detected",
      evidence: `Observed non-provider domain in BrowserUse output: ${domain}`,
    };
  }
  return null;
}

export function extractDryRunCheckoutProof(output: unknown): {
  reachedCheckout: boolean;
  evidence: string;
} {
  const text = stringifyUnknown(output);
  const lower = text.toLowerCase();
  const reachedCheckout =
    lower.includes("checkout") ||
    lower.includes("/checkout") ||
    lower.includes("review order") ||
    lower.includes("payment page");
  return {
    reachedCheckout,
    evidence: text.slice(0, 500),
  };
}

export function outputSuggestsManualIntervention(output: unknown): boolean {
  if (typeof output !== "string") return false;
  const t = output.toLowerCase();
  return (
    t.includes("need you to log in") ||
    t.includes("please log in") ||
    t.includes("need to be logged") ||
    t.includes("sign-in") ||
    t.includes("sign in") ||
    t.includes("requires a login") ||
    t.includes("captcha") ||
    t.includes("2fa") ||
    t.includes("two-factor") ||
    t.includes("verification code")
  );
}

export function extractLikelyApiKey(output: unknown): string | null {
  if (typeof output !== "string") return null;
  const patterns = [/(sk-[A-Za-z0-9_\-]{12,})/, /(or-[A-Za-z0-9_\-]{12,})/, /(rk_[A-Za-z0-9_\-]{12,})/];
  for (const p of patterns) {
    const m = output.match(p);
    if (m && m[1]) return m[1];
  }
  return null;
}

export async function bestEffortValidateApiKey(input: {
  provider: string;
  apiKey: string;
}): Promise<{ supported: boolean; verified: boolean; error?: string }> {
  const provider = normalizeLower(input.provider);
  const timeoutMs = 2_500;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    if (provider === "openrouter") {
      const base = (process.env.OPENROUTER_API_BASE ?? "https://openrouter.ai/api/v1").trim();
      const res = await fetch(`${base}/auth/key`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: abort.signal,
      });
      return { supported: true, verified: res.ok, ...(res.ok ? {} : { error: `http_${res.status}` }) };
    }
    if (provider === "elevenlabs") {
      const base = (process.env.ELEVENLABS_API_BASE ?? "https://api.elevenlabs.io/v1").trim();
      const res = await fetch(`${base}/user/subscription`, {
        method: "GET",
        headers: {
          "xi-api-key": input.apiKey,
          "Content-Type": "application/json",
        },
        signal: abort.signal,
      });
      return { supported: true, verified: res.ok, ...(res.ok ? {} : { error: `http_${res.status}` }) };
    }
    return { supported: false, verified: false };
  } catch (error) {
    return {
      supported: provider === "openrouter" || provider === "elevenlabs",
      verified: false,
      error: error instanceof Error ? error.message : "validator_request_failed",
    };
  } finally {
    clearTimeout(timer);
  }
}
