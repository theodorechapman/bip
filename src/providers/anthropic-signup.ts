/**
 * LLM provider key — tries OpenRouter first (free credits), falls back to Anthropic.
 * Reuses the existing OpenRouter signup flow.
 */

import { getOpenRouterKey } from "./openrouter";

export async function getAnthropicOrOpenRouterKey(): Promise<{
  key: string;
  provider: "anthropic" | "openrouter";
} | null> {
  // Try OpenRouter first — free credits, no payment needed
  console.log("\n   Attempting OpenRouter signup (free credits)...");

  try {
    const key = await getOpenRouterKey();
    if (key && key.startsWith("sk-or-")) {
      console.log("   OpenRouter key obtained successfully");
      return { key, provider: "openrouter" };
    }
    console.log("   OpenRouter signup did not return a valid key");
  } catch (e: any) {
    console.log(`   OpenRouter signup failed: ${e?.message ?? e}`);
  }

  // Anthropic direct signup would require payment info — not feasible for zero-touch
  // Report gracefully so the bootstrap can continue without an LLM key
  console.log("   Anthropic direct signup requires payment — skipping");
  console.log("   You can manually set ANTHROPIC_API_KEY or OPENROUTER_API_KEY in .env.local");

  return null;
}
