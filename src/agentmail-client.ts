/**
 * AgentMail REST client — direct HTTP calls to https://api.agentmail.to
 * Port of bip-bu/agent_email.py
 */

const AGENTMAIL_BASE = "https://api.agentmail.to/v0";

function getApiKey(): string {
  const key = process.env.AGENTMAIL_API_KEY;
  if (!key) throw new Error("AGENTMAIL_API_KEY not set in .env");
  return key;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    "Content-Type": "application/json",
  };
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${AGENTMAIL_BASE}${path}`, { headers: headers() });
  if (!res.ok) throw new Error(`AgentMail GET ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${AGENTMAIL_BASE}${path}`, {
    method: "POST",
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`AgentMail POST ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

type Inbox = {
  inbox_id: string;
  email: string;
  [key: string]: unknown;
};

type Message = {
  message_id: string;
  text?: string;
  html?: string;
  [key: string]: unknown;
};

export async function createOrReuseInbox(forceNew = false): Promise<Inbox> {
  if (!forceNew) {
    const list = await apiGet<{ inboxes: Inbox[] }>("/inboxes");
    if (list.inboxes && list.inboxes.length > 0) {
      const inbox = list.inboxes[0];
      console.log(`   Reusing inbox: ${inbox.inbox_id}`);
      return inbox;
    }
  }
  const inbox = await apiPost<Inbox>("/inboxes");
  console.log(`   Created inbox: ${inbox.inbox_id}`);
  return inbox;
}

export async function getExistingMessageIds(inboxId: string): Promise<Set<string>> {
  const list = await apiGet<{ messages: Message[] }>(`/inboxes/${inboxId}/messages`);
  if (list.messages && list.messages.length > 0) {
    return new Set(list.messages.map((m) => m.message_id));
  }
  return new Set();
}

export async function waitForEmail(
  inboxId: string,
  knownIds: Set<string>,
  timeout = 120,
  pollInterval = 5,
): Promise<Message | null> {
  const start = Date.now();

  while (Date.now() - start < timeout * 1000) {
    const list = await apiGet<{ messages: Message[] }>(`/inboxes/${inboxId}/messages`);
    if (list.messages) {
      for (const msg of list.messages) {
        if (!knownIds.has(msg.message_id)) {
          const full = await apiGet<Message>(`/inboxes/${inboxId}/messages/${msg.message_id}`);
          return full;
        }
      }
    }
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`   Waiting for email... (${elapsed}s)`);
    await new Promise((resolve) => setTimeout(resolve, pollInterval * 1000));
  }

  console.log("   Timed out waiting for email.");
  return null;
}

export function extractVerificationLink(message: Message): string | null {
  let body = message.text || message.html || "";
  // Decode common HTML entities
  body = body
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  const patterns = [
    /https?:\/\/[^\s<>"]+(?:verify|confirm|activate|token|callback|auth)[^\s<>"]*/,
    /https?:\/\/[^\s<>"]+/,
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) return match[0];
  }
  return null;
}
