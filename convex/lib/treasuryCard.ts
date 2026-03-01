/**
 * Treasury card types and redaction helpers.
 * Pure functions — no convex exports.
 */

export type TreasuryCardSecret = {
  label: string;
  pan: string;
  expMonth: string;
  expYear: string;
  cvv: string;
  nameOnCard: string;
  billingZip: string | null;
  last4: string;
  status: string;
};

export type TreasuryCardResolved = TreasuryCardSecret & {
  cardRef: string;
};

export function parseTreasuryCardSecret(value: string): TreasuryCardSecret | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const card = parsed as Record<string, unknown>;
  const pan = typeof card.pan === "string" ? card.pan.trim() : "";
  const cvv = typeof card.cvv === "string" ? card.cvv.trim() : "";
  const label = typeof card.label === "string" ? card.label.trim() : "";
  const expMonth = typeof card.expMonth === "string" ? card.expMonth.trim() : "";
  const expYear = typeof card.expYear === "string" ? card.expYear.trim() : "";
  const nameOnCard =
    typeof card.nameOnCard === "string" ? card.nameOnCard.trim() : "";
  if (!pan || !cvv || !label || !expMonth || !expYear || !nameOnCard) return null;
  const billingZip =
    typeof card.billingZip === "string" && card.billingZip.trim().length > 0
      ? card.billingZip.trim()
      : null;
  const last4 =
    typeof card.last4 === "string" && card.last4.length === 4
      ? card.last4
      : pan.slice(-4);
  const status =
    typeof card.status === "string" && card.status.trim().length > 0
      ? card.status.trim()
      : "active";
  return {
    label,
    pan,
    expMonth,
    expYear,
    cvv,
    nameOnCard,
    billingZip,
    last4,
    status,
  };
}

export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactSensitiveValue(value: string, sensitiveTokens: Array<string>): string {
  let out = value;
  for (const token of sensitiveTokens) {
    if (!token) continue;
    out = out.replace(new RegExp(escapeRegExp(token), "g"), "[REDACTED]");
  }
  return out;
}

export function redactSensitiveOutput(
  value: unknown,
  sensitiveTokens: Array<string>,
): unknown {
  if (typeof value === "string") {
    return redactSensitiveValue(value, sensitiveTokens);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveOutput(item, sensitiveTokens));
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactSensitiveOutput(val, sensitiveTokens);
    }
    return out;
  }
  return value;
}
