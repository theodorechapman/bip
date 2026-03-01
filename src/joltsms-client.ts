/**
 * JoltSMS REST client — direct HTTP calls to https://api.joltsms.com
 * Provides real non-VoIP US phone numbers for agent SMS verification.
 */

const JOLTSMS_BASE = "https://api.joltsms.com/v1";

function getApiKey(): string {
  const key = process.env.JOLTSMS_API_KEY;
  if (!key) throw new Error("JOLTSMS_API_KEY not set in .env");
  return key;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    "Content-Type": "application/json",
  };
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${JOLTSMS_BASE}${path}`, { headers: headers() });
  if (!res.ok) throw new Error(`JoltSMS GET ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${JOLTSMS_BASE}${path}`, {
    method: "POST",
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`JoltSMS POST ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${JOLTSMS_BASE}${path}`, {
    method: "PUT",
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`JoltSMS PUT ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

// ── Types ──────────────────────────────────────────────────────────

export type JoltNumber = {
  id: string;
  phoneNumber: string;
  status: string;
  areaCode?: string;
  [key: string]: unknown;
};

export type JoltMessage = {
  id: string;
  from: string;
  to: string;
  body: string;
  parsedCode?: string;
  receivedAt: string;
  read: boolean;
  [key: string]: unknown;
};

type PaginatedResponse<T> = {
  data: T[];
  meta: {
    hasMore: boolean;
    nextCursor?: string;
    total: number;
    limit: number;
  };
};

// ── Number Management ──────────────────────────────────────────────

export async function listNumbers(): Promise<JoltNumber[]> {
  const res = await apiGet<PaginatedResponse<JoltNumber>>("/numbers?status=active&limit=10");
  return res.data;
}

export async function rentNumber(areaCode?: string): Promise<JoltNumber> {
  const body: Record<string, unknown> = { autoRenew: true };
  if (areaCode) {
    body.areaCode = areaCode;
    body.preferredAreaCode = true;
  }
  const number = await apiPost<JoltNumber>("/numbers/rent", body);
  console.log(`   Rented number: ${number.phoneNumber} (${number.id})`);
  return number;
}

export async function getNumber(numberId: string): Promise<JoltNumber> {
  return apiGet<JoltNumber>(`/numbers/${encodeURIComponent(numberId)}`);
}

export async function reuseOrRentNumber(areaCode?: string): Promise<JoltNumber> {
  const numbers = await listNumbers();
  if (numbers.length > 0) {
    const existing = numbers[0]!;
    console.log(`   Reusing number: ${existing.phoneNumber} (${existing.id})`);
    return existing;
  }
  return rentNumber(areaCode);
}

// ── Message / OTP ──────────────────────────────────────────────────

export async function listMessages(
  numberId: string,
  since?: string,
): Promise<JoltMessage[]> {
  let path = `/messages?numberId=${encodeURIComponent(numberId)}&limit=20`;
  if (since) path += `&since=${encodeURIComponent(since)}`;
  const res = await apiGet<PaginatedResponse<JoltMessage>>(path);
  return res.data;
}

export async function getLatestOtp(
  numberId: string,
  since?: string,
): Promise<string | null> {
  const messages = await listMessages(numberId, since);
  for (const msg of messages) {
    if (msg.parsedCode) return msg.parsedCode;
  }
  return null;
}

export async function waitForOtp(
  numberId: string,
  timeout = 120,
  pollInterval = 5,
): Promise<{ code: string; message: JoltMessage } | null> {
  const start = Date.now();
  const since = new Date().toISOString();

  while (Date.now() - start < timeout * 1000) {
    const messages = await listMessages(numberId, since);
    for (const msg of messages) {
      if (msg.parsedCode) {
        console.log(`   OTP received: ${msg.parsedCode}`);
        return { code: msg.parsedCode, message: msg };
      }
    }
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`   Waiting for SMS... (${elapsed}s)`);
    await new Promise((r) => setTimeout(r, pollInterval * 1000));
  }

  console.log("   Timed out waiting for SMS.");
  return null;
}

export async function markRead(messageId: string): Promise<void> {
  await apiPut(`/messages/${encodeURIComponent(messageId)}/read`);
}

// ── OTP Extraction Fallback ────────────────────────────────────────

export function extractOtpFromBody(body: string): string | null {
  // Match 4-8 digit codes that look like OTPs
  const patterns = [
    /\b(\d{6})\b/,     // 6-digit (most common)
    /\b(\d{4})\b/,     // 4-digit
    /\b(\d{8})\b/,     // 8-digit
    /\b(\d{5})\b/,     // 5-digit
    /\b(\d{7})\b/,     // 7-digit
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}
