/**
 * 2Captcha API client for Arkose Labs FunCaptcha solving.
 * Pure async functions — no convex exports.
 */

const TWOCAPTCHA_BASE = "https://api.2captcha.com";

// Default Arkose public keys for X/Twitter
const X_SIGNUP_ARKOSE_KEY = "2CB16598-CB82-4CF7-B332-5990DB66F3AB";
const X_UNLOCK_ARKOSE_KEY = "0152B4EB-D2DC-460A-89A1-629838B529C9";

export function getXArkosePublicKey(variant: "signup" | "unlock" = "signup"): string {
  const envKey = process.env.X_ARKOSE_PUBLIC_KEY;
  if (envKey) return envKey;
  return variant === "unlock" ? X_UNLOCK_ARKOSE_KEY : X_SIGNUP_ARKOSE_KEY;
}

/**
 * Solve an Arkose Labs FunCaptcha via 2Captcha's API.
 * Uses FunCaptchaTaskProxyless — 2Captcha handles the solving server-side.
 *
 * @returns token string on success, or error description on failure
 */
export async function solveArkoseCaptcha(options: {
  publicKey: string;
  pageUrl: string;
  subdomain?: string;
}): Promise<{ ok: boolean; token?: string; error?: string; elapsedMs?: number }> {
  const apiKey = (process.env.TWOCAPTCHA_API_KEY ?? "").trim();
  if (!apiKey) {
    return { ok: false, error: "TWOCAPTCHA_API_KEY not configured" };
  }

  const startMs = Date.now();

  // Step 1: Create the task
  let taskId: string;
  try {
    const createResp = await fetch(`${TWOCAPTCHA_BASE}/createTask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientKey: apiKey,
        task: {
          type: "FunCaptchaTaskProxyless",
          websiteURL: options.pageUrl,
          websitePublicKey: options.publicKey,
          ...(options.subdomain ? { funcaptchaApiJSSubdomain: options.subdomain } : {}),
        },
      }),
    });

    if (!createResp.ok) {
      const errText = await createResp.text();
      return { ok: false, error: `2captcha createTask http ${createResp.status}: ${errText.slice(0, 300)}` };
    }

    const createData = (await createResp.json()) as {
      errorId?: number;
      errorCode?: string;
      errorDescription?: string;
      taskId?: number;
    };

    if (createData.errorId && createData.errorId !== 0) {
      return { ok: false, error: `2captcha createTask error: ${createData.errorCode} — ${createData.errorDescription}` };
    }

    if (!createData.taskId) {
      return { ok: false, error: "2captcha createTask: no taskId in response" };
    }

    taskId = String(createData.taskId);
  } catch (err: any) {
    return { ok: false, error: `2captcha createTask fetch failed: ${err?.message ?? "unknown"}` };
  }

  // Step 2: Poll for result (every 5s, timeout 120s)
  const pollIntervalMs = 5_000;
  const timeoutMs = 120_000;
  const deadline = startMs + timeoutMs;

  // Initial wait — 2captcha recommends waiting at least 10s before first poll
  await new Promise((resolve) => setTimeout(resolve, 10_000));

  while (Date.now() < deadline) {
    try {
      const resultResp = await fetch(`${TWOCAPTCHA_BASE}/getTaskResult`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientKey: apiKey,
          taskId: Number(taskId),
        }),
      });

      if (!resultResp.ok) {
        // Transient HTTP error — keep polling
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        continue;
      }

      const resultData = (await resultResp.json()) as {
        errorId?: number;
        errorCode?: string;
        errorDescription?: string;
        status?: string;
        solution?: { token?: string };
      };

      if (resultData.errorId && resultData.errorId !== 0) {
        return {
          ok: false,
          error: `2captcha getTaskResult error: ${resultData.errorCode} — ${resultData.errorDescription}`,
          elapsedMs: Date.now() - startMs,
        };
      }

      if (resultData.status === "ready" && resultData.solution?.token) {
        return {
          ok: true,
          token: resultData.solution.token,
          elapsedMs: Date.now() - startMs,
        };
      }

      // Still processing
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    } catch {
      // Network error — retry
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  return {
    ok: false,
    error: `2captcha solve timed out after ${Math.round(timeoutMs / 1000)}s`,
    elapsedMs: Date.now() - startMs,
  };
}

/**
 * Check if a browser-use error/output indicates an Arkose/FunCaptcha block.
 */
export function detectCaptchaBlock(error?: string, output?: unknown): boolean {
  const text = `${error ?? ""} ${typeof output === "string" ? output : ""}`.toLowerCase();
  return (
    text.includes("captcha") ||
    text.includes("arkose") ||
    text.includes("funcaptcha") ||
    text.includes("bot protection") ||
    text.includes("captcha_blocked") ||
    text.includes("verification puzzle")
  );
}
