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
  {
    offeringId: "x.account.bootstrap",
    intentType: "x_account_bootstrap",
    provider: "x",
    rail: "auto",
    riskClass: "high",
    requiresHandoff: "often",
    inputs: ["profileName", "handle", "bio", "emailMode"],
    outputs: ["accountHandle", "verificationStatus", "credentialRef", "traceId"],
  },
  {
    offeringId: "x.post.create",
    intentType: "x_post",
    provider: "x",
    rail: "auto",
    riskClass: "medium",
    requiresHandoff: "sometimes",
    inputs: ["postText", "imageBase64"],
    outputs: ["postUrl", "traceId"],
  },
  {
    offeringId: "cj.account.bootstrap",
    intentType: "cj_account_bootstrap",
    provider: "cj",
    rail: "auto",
    riskClass: "medium",
    requiresHandoff: "often",
    inputs: ["dryRun"],
    outputs: ["credentialRef", "email", "traceId"],
  },
  {
    offeringId: "shopify.store.create",
    intentType: "shopify_store_create",
    provider: "shopify",
    rail: "auto",
    riskClass: "medium",
    requiresHandoff: "often",
    inputs: ["storeName", "niche"],
    outputs: ["credentialRef", "domain", "traceId"],
  },
  {
    offeringId: "shopify.product.source",
    intentType: "shopify_source_products",
    provider: "cj",
    rail: "auto",
    riskClass: "low",
    requiresHandoff: "never",
    inputs: ["keywords", "category", "maxResults", "maxPriceUsd"],
    outputs: ["productsSourced", "products", "traceId"],
  },
  {
    offeringId: "shopify.product.list",
    intentType: "shopify_list_products",
    provider: "shopify",
    rail: "auto",
    riskClass: "low",
    requiresHandoff: "never",
    inputs: ["marginPct", "dryRun"],
    outputs: ["productsListed", "traceId"],
  },
  {
    offeringId: "shopify.order.fulfill",
    intentType: "shopify_fulfill_orders",
    provider: "shopify",
    rail: "auto",
    riskClass: "medium",
    requiresHandoff: "never",
    inputs: ["dryRun"],
    outputs: ["ordersFulfilled", "traceId"],
  },
  {
    offeringId: "shopify.dropship.cycle",
    intentType: "shopify_cycle",
    provider: "shopify",
    rail: "auto",
    riskClass: "medium",
    requiresHandoff: "never",
    inputs: ["keywords", "maxProducts", "marginPct", "skipSourcing", "skipListing", "skipFulfillment", "dryRun"],
    outputs: ["productsSourced", "productsListed", "ordersFulfilled", "traceId"],
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
  {
    offeringId: "x.account.bootstrap",
    intentType: "x_account_bootstrap",
    providerAllowlist: ["x"],
    maxBudgetCentsPerIntent: 2_500,
    maxBudgetCentsPerDay: 5_000,
    enabled: true,
  },
  {
    offeringId: "x.post.create",
    intentType: "x_post",
    providerAllowlist: ["x"],
    maxBudgetCentsPerIntent: 500,
    maxBudgetCentsPerDay: 2_500,
    enabled: true,
  },
  {
    offeringId: "cj.account.bootstrap",
    intentType: "cj_account_bootstrap",
    providerAllowlist: ["cj"],
    maxBudgetCentsPerIntent: 2_500,
    maxBudgetCentsPerDay: 5_000,
    enabled: true,
  },
  {
    offeringId: "shopify.store.create",
    intentType: "shopify_store_create",
    providerAllowlist: ["shopify"],
    maxBudgetCentsPerIntent: 5_000,
    maxBudgetCentsPerDay: 10_000,
    enabled: true,
  },
  {
    offeringId: "shopify.product.source",
    intentType: "shopify_source_products",
    providerAllowlist: ["cj"],
    maxBudgetCentsPerIntent: 500,
    maxBudgetCentsPerDay: 2_500,
    enabled: true,
  },
  {
    offeringId: "shopify.product.list",
    intentType: "shopify_list_products",
    providerAllowlist: ["shopify"],
    maxBudgetCentsPerIntent: 1_000,
    maxBudgetCentsPerDay: 5_000,
    enabled: true,
  },
  {
    offeringId: "shopify.order.fulfill",
    intentType: "shopify_fulfill_orders",
    providerAllowlist: ["shopify"],
    maxBudgetCentsPerIntent: 500,
    maxBudgetCentsPerDay: 2_500,
    enabled: true,
  },
  {
    offeringId: "shopify.dropship.cycle",
    intentType: "shopify_cycle",
    providerAllowlist: ["shopify"],
    maxBudgetCentsPerIntent: 2_500,
    maxBudgetCentsPerDay: 10_000,
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
