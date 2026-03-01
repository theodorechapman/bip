/**
 * Browser Use and Bitrefill API callers.
 * Pure async functions — no convex exports.
 */

export async function callBrowserUseTask(
  task: string,
  apiKeyOverride?: string,
  options?: {
    maxSteps?: number;
    timeoutMs?: number;
    sessionId?: string;
    profileId?: string;
    allowedDomains?: string[];
    proxyCountryCode?: string;
    keepAlive?: boolean;
  },
): Promise<{
  ok: boolean;
  taskId?: string;
  output?: unknown;
  raw?: unknown;
  error?: string;
  liveUrl?: string;
  handoffUrl?: string;
  sessionId?: string;
}> {
  const apiKey = (apiKeyOverride ?? process.env.BROWSER_USE_API_KEY ?? "").trim();
  if (!apiKey) {
    return { ok: false, error: "BROWSER_USE_API_KEY not configured" };
  }

  const base = process.env.BROWSER_USE_API_BASE?.trim() || "https://api.browser-use.com";
  const proxyCountryCode = options?.proxyCountryCode ?? process.env.BROWSER_USE_PROXY_COUNTRY ?? "us";
  const keepAlive = options?.keepAlive ?? true;

  // ── Create a session with proxy + profile support ──
  let sessionId = options?.sessionId;
  let liveUrl: string | undefined;
  if (!sessionId) {
    try {
      const sessionBody: Record<string, unknown> = {
        keepAlive,
        proxyCountryCode,
      };
      if (options?.profileId) {
        sessionBody.profileId = options.profileId;
      }
      const sessionResp = await fetch(`${base}/api/v2/sessions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "X-Browser-Use-API-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(sessionBody),
      });
      if (sessionResp.ok) {
        const sessionData = (await sessionResp.json()) as { id?: string; liveUrl?: string; live_url?: string };
        sessionId = sessionData.id;
        liveUrl = sessionData.liveUrl ?? sessionData.live_url;
      }
    } catch {
      // non-fatal — proceed without session
    }
  }

  // API v2 fallback path for broad compatibility.
  const createResp = await fetch(`${base}/api/v2/tasks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Browser-Use-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      task,
      ...(typeof options?.maxSteps === "number" ? { maxSteps: options.maxSteps, max_steps: options.maxSteps } : {}),
      ...(sessionId ? { session_id: sessionId } : {}),
      ...(options?.allowedDomains?.length ? { allowed_domains: options.allowedDomains } : {}),
    }),
  });

  if (!createResp.ok) {
    const err = await createResp.text();
    return { ok: false, error: `bu create task failed (${createResp.status}): ${err.slice(0, 400)}` };
  }

  const created = (await createResp.json()) as { id?: string; task_id?: string };
  const taskId = created.id ?? created.task_id;
  if (!taskId) return { ok: false, error: "bu task id missing in response", raw: created };

  const timeoutMs = options?.timeoutMs ?? 240_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const statusResp = await fetch(`${base}/api/v2/tasks/${taskId}/status`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Browser-Use-API-Key": apiKey,
      },
    });
    if (!statusResp.ok) {
      const err = await statusResp.text();
      return { ok: false, error: `bu status failed (${statusResp.status}): ${err.slice(0, 400)}` };
    }

    const statusData = (await statusResp.json()) as {
      status?: string;
      output?: unknown;
      cost?: unknown;
      error?: unknown;
      isSuccess?: boolean;
      is_success?: boolean;
      finishedAt?: string;
    };

    const status = (statusData.status ?? "").toString().toLowerCase();
    const handoffUrl = `https://cloud.browser-use.com/tasks/${taskId}`;
    if (["finished", "completed", "succeeded", "success"].includes(status)) {
      // browser-use can return finished with isSuccess: false (e.g. captcha blocked)
      const isSuccess = statusData.isSuccess ?? statusData.is_success ?? true;
      if (!isSuccess) {
        const outputStr = typeof statusData.output === "string" ? statusData.output : "";
        return {
          ok: false,
          taskId,
          output: statusData.output,
          error: outputStr || `task finished but isSuccess=false`,
          raw: statusData,
          liveUrl,
          handoffUrl,
          sessionId,
        };
      }
      return { ok: true, taskId, output: statusData.output, raw: statusData, liveUrl, handoffUrl, sessionId };
    }
    if (["failed", "error", "stopped", "cancelled", "canceled"].includes(status)) {
      return {
        ok: false,
        taskId,
        error: typeof statusData.error === "string" ? statusData.error : `task ${status}`,
        raw: statusData,
        liveUrl,
        handoffUrl,
        sessionId,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  return { ok: false, taskId, error: `bu task timeout after ${Math.round(timeoutMs / 1000)}s`, raw: { status: "timeout" }, liveUrl, handoffUrl: `https://cloud.browser-use.com/tasks/${taskId}`, sessionId };
}

/**
 * Execute a Browser Use skill — deterministic, cheap ($0.02/call).
 * Skills must be pre-created and their IDs stored.
 */
export async function callBrowserUseSkill(
  skillId: string,
  parameters: Record<string, unknown>,
  apiKeyOverride?: string,
  options?: { sessionId?: string; profileId?: string; proxyCountryCode?: string },
): Promise<{
  ok: boolean;
  result?: unknown;
  latencyMs?: number;
  error?: string;
}> {
  const apiKey = (apiKeyOverride ?? process.env.BROWSER_USE_API_KEY ?? "").trim();
  if (!apiKey) {
    return { ok: false, error: "BROWSER_USE_API_KEY not configured" };
  }

  const base = process.env.BROWSER_USE_API_BASE?.trim() || "https://api.browser-use.com";
  const proxyCountryCode = options?.proxyCountryCode ?? process.env.BROWSER_USE_PROXY_COUNTRY ?? "us";

  // create a session if profileId provided or we need proxy routing
  let sessionId = options?.sessionId;
  if (!sessionId && (options?.profileId || proxyCountryCode)) {
    try {
      const sessionBody: Record<string, unknown> = {
        keepAlive: false,
        proxyCountryCode,
      };
      if (options?.profileId) {
        sessionBody.profileId = options.profileId;
      }
      const sessionResp = await fetch(`${base}/api/v2/sessions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "X-Browser-Use-API-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(sessionBody),
      });
      if (sessionResp.ok) {
        const sessionData = (await sessionResp.json()) as { id?: string };
        sessionId = sessionData.id;
      }
    } catch {
      // non-fatal
    }
  }

  try {
    const resp = await fetch(`${base}/api/v2/skills/${skillId}/execute`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Browser-Use-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parameters,
        ...(sessionId ? { sessionId } : {}),
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return { ok: false, error: `bu skill failed (${resp.status}): ${err.slice(0, 400)}` };
    }

    const data = (await resp.json()) as {
      success?: boolean;
      result?: unknown;
      error?: string | null;
      latencyMs?: number | null;
    };

    if (!data.success) {
      return { ok: false, error: data.error ?? "skill_execution_failed" };
    }

    return {
      ok: true,
      result: data.result,
      latencyMs: data.latencyMs ?? undefined,
    };
  } finally {
    // stop session if we created it
    if (options?.profileId && sessionId) {
      try {
        await fetch(`${base}/api/v2/sessions/${sessionId}`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "X-Browser-Use-API-Key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "stop" }),
        });
      } catch {
        // best-effort cleanup
      }
    }
  }
}

export async function tryVerifyViaFetch(link: string): Promise<{ ok: boolean; statusCode: number | null }> {
  try {
    const resp = await fetch(link, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BipAgent/1.0)",
      },
    });
    return { ok: resp.status >= 200 && resp.status < 400, statusCode: resp.status };
  } catch {
    return { ok: false, statusCode: null };
  }
}

export function buildBrowserUseHandoffUrl(taskId: string | undefined): string | null {
  if (!taskId) return null;
  const template = (process.env.BROWSER_USE_TASK_URL_TEMPLATE ?? "https://cloud.browser-use.com/tasks/{taskId}").trim();
  if (!template) return null;
  return template.replaceAll("{taskId}", taskId);
}

export async function callBitrefillPurchase(input: { productId?: string; amount?: number; recipientEmail?: string; note?: string }): Promise<{ ok: boolean; orderId?: string; code?: string; raw?: unknown; error?: string; }> {
  const apiKey = (process.env.BITREFILL_API_KEY ?? "").trim();
  if (!apiKey) return { ok: false, error: "BITREFILL_API_KEY not configured" };
  const base = (process.env.BITREFILL_API_BASE ?? "https://api.bitrefill.com").trim();

  const createResp = await fetch(`${base}/v2/orders`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      productId: input.productId,
      amount: input.amount,
      recipientEmail: input.recipientEmail,
      note: input.note,
    }),
  });

  const bodyText = await createResp.text();
  let body: any = null;
  try { body = bodyText ? JSON.parse(bodyText) : null; } catch { body = { raw: bodyText }; }
  if (!createResp.ok) {
    return { ok: false, error: `bitrefill order failed (${createResp.status})`, raw: body };
  }

  const orderId = body?.id ?? body?.orderId ?? null;
  const code = body?.code ?? body?.voucherCode ?? body?.claimCode ?? null;
  return { ok: true, orderId: orderId ?? undefined, code: code ?? undefined, raw: body };
}
