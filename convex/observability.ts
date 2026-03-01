/**
 * Observability integration for BIP.
 *
 * Pushes trace events to Laminar and HUD via raw HTTP.
 * The @lmnr-ai/lmnr SDK cannot be used in Convex (node builtin deps),
 * so we use the REST ingest API directly.
 */

// ── Types ──────────────────────────────────────────────────────────

type TracePhase = "started" | "rail_selected" | "failed" | "confirmed";

export interface TraceEvent {
  traceId: string;
  runId: string;
  intentId: string;
  phase: TracePhase;
  status: string;
  rail?: string;
  budgetUsd?: number;
  task?: string;
  taskId?: string | null;
  error?: string | null;
  startedAt?: number;
  endedAt?: number;
}

// ── Raw HTTP push ─────────────────────────────────────────────────

async function postJson(
  url: string,
  payload: unknown,
  headers: Record<string, string>,
): Promise<void> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`trace sink failed (${resp.status}): ${body.slice(0, 240)}`);
  }
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Emit a trace event to configured sinks (Laminar, HUD) via HTTP.
 */
export async function emitTrace(event: TraceEvent): Promise<void> {
  const laminarUrl = (process.env.LAMINAR_INGEST_URL ?? "").trim();
  const laminarApiKey = (
    process.env.LMNR_PROJECT_API_KEY ??
    process.env.LAMINAR_API_KEY ??
    ""
  ).trim();
  const hudUrl = (process.env.HUD_TRACE_URL ?? "").trim();
  const hudApiKey = (process.env.HUD_API_KEY ?? "").trim();

  const payload = { source: "bip", ts: Date.now(), ...event };

  const writes: Promise<void>[] = [];
  if (laminarUrl) {
    writes.push(
      postJson(laminarUrl, payload, laminarApiKey ? { Authorization: `Bearer ${laminarApiKey}` } : {}),
    );
  }
  if (hudUrl) {
    writes.push(
      postJson(hudUrl, payload, hudApiKey ? { Authorization: `Bearer ${hudApiKey}` } : {}),
    );
  }
  if (writes.length === 0) return;

  const settled = await Promise.allSettled(writes);
  const err = settled.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  if (err) {
    console.error("[trace] emit failed", err.reason);
  }
}

