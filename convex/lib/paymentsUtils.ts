/**
 * Shared payment utility helpers.
 * Pure functions with no convex exports — safe to import from anywhere.
 */

const LAMPORTS_PER_SOL = 1_000_000_000;

export function randomId(prefix: string): string {
  const values = new Uint8Array(8);
  crypto.getRandomValues(values);
  const hex = Array.from(values)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}_${hex}`;
}

export function now(): number {
  return Date.now();
}

export function utcDayStartTs(ts: number): number {
  const date = new Date(ts);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function getPaymentsMode(): "free" | "metered" {
  const mode = (process.env.PAYMENTS_MODE ?? "free").trim().toLowerCase();
  return mode === "metered" ? "metered" : "free";
}

export function getMinBudgetUsd(): number {
  const raw = Number(process.env.MIN_INTENT_BUDGET_USD ?? "1");
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

export function isSubsidyMode(): boolean {
  return (process.env.SUBSIDY_MODE ?? "true").trim().toLowerCase() !== "false";
}

export function getBrowserUseMaxSteps(): number {
  const raw = Number(process.env.BROWSER_USE_MAX_STEPS ?? "30");
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 30;
}

export function getSolAutoSpendCapUsd(): number {
  const raw = Number(process.env.SOL_AUTO_SPEND_CAP_USD ?? "10");
  return Number.isFinite(raw) && raw > 0 ? raw : 10;
}

export function getSolRpcUrl(): string {
  return (process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com").trim();
}

export function getSolanaFundingUsdPerSol(): number {
  const raw = Number(process.env.SOLANA_FUNDING_USD_PER_SOL ?? "100");
  return Number.isFinite(raw) && raw > 0 ? raw : 100;
}

export function solLamportsToFundingCents(lamports: number): number {
  const sol = lamports / LAMPORTS_PER_SOL;
  const amount = Math.round(sol * getSolanaFundingUsdPerSol() * 100);
  return Math.max(1, amount);
}

export { LAMPORTS_PER_SOL };
