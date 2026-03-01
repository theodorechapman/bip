export type OfferingRiskClass = "low" | "medium" | "high";
export type OfferingHandoff = "never" | "sometimes" | "often";

export type Phase1Offering = {
  offeringId: string;
  intentType: string;
  provider: string;
  rail: string;
  riskClass: OfferingRiskClass;
  requiresHandoff: OfferingHandoff;
  inputs: Array<string>;
  outputs: Array<string>;
};

export type OfferingPolicyDefault = {
  offeringId: string;
  intentType: string;
  providerAllowlist: Array<string>;
  maxBudgetCentsPerIntent: number;
  maxBudgetCentsPerDay: number;
  enabled: boolean;
};

export const PHASE1_OFFERINGS: Array<Phase1Offering> = [
  {
    offeringId: "giftcard.bitrefill.buy",
    intentType: "giftcard_purchase",
    provider: "bitrefill",
    rail: "bitrefill|auto",
    riskClass: "medium",
    requiresHandoff: "sometimes",
    inputs: ["brand", "amountUsd", "recipientEmail"],
    outputs: ["orderId", "codeRef", "receiptRef", "traceId"],
  },
  {
    offeringId: "apikey.provider.buy",
    intentType: "api_key_purchase",
    provider: "openrouter|elevenlabs|...",
    rail: "auto",
    riskClass: "high",
    requiresHandoff: "often",
    inputs: ["provider", "budgetUsd", "accountEmailMode"],
    outputs: ["credentialRef", "proofRef", "traceId"],
  },
  {
    offeringId: "account.bootstrap",
    intentType: "account_bootstrap",
    provider: "bitrefill|x|shopify|...",
    rail: "auto",
    riskClass: "medium",
    requiresHandoff: "often",
    inputs: ["provider", "emailMode"],
    outputs: ["accountStatus", "nextAction", "traceId"],
  },
];

export const PHASE1_POLICY_DEFAULTS: Array<OfferingPolicyDefault> = [
  {
    offeringId: "giftcard.bitrefill.buy",
    intentType: "giftcard_purchase",
    providerAllowlist: ["bitrefill"],
    maxBudgetCentsPerIntent: 25_000,
    maxBudgetCentsPerDay: 100_000,
    enabled: true,
  },
  {
    offeringId: "apikey.provider.buy",
    intentType: "api_key_purchase",
    providerAllowlist: ["openrouter", "elevenlabs"],
    maxBudgetCentsPerIntent: 5_000,
    maxBudgetCentsPerDay: 15_000,
    enabled: true,
  },
  {
    offeringId: "account.bootstrap",
    intentType: "account_bootstrap",
    providerAllowlist: ["bitrefill", "x", "shopify"],
    maxBudgetCentsPerIntent: 2_500,
    maxBudgetCentsPerDay: 7_500,
    enabled: true,
  },
];

export function normalizeLower(value: string): string {
  return value.trim().toLowerCase();
}

export function findPhase1Offering(
  intentType: string,
  provider: string,
): Phase1Offering | null {
  const intentTypeNorm = normalizeLower(intentType);
  const providerNorm = normalizeLower(provider);
  const policy = PHASE1_POLICY_DEFAULTS.find((entry) => {
    if (normalizeLower(entry.intentType) !== intentTypeNorm) {
      return false;
    }
    return entry.providerAllowlist.some((p) => normalizeLower(p) === providerNorm);
  });
  if (!policy) return null;
  return (
    PHASE1_OFFERINGS.find((offering) => offering.offeringId === policy.offeringId) ?? null
  );
}
