/**
 * Shared LLM Factory
 * Extracted from store-setup.ts — same fallback chain.
 */

import { ChatAnthropic } from "browser-use/llm/anthropic";
import { ChatOpenAI } from "browser-use/llm/openai";
import { ChatCodex, isCodexAvailable } from "../../src/llm/codex";

export function getLLM() {
  if (isCodexAvailable()) {
    console.log("[LLM] Using Codex (free via ChatGPT subscription)");
    return new ChatCodex({ model: "gpt-5.3-codex" });
  }
  if (process.env.OPENAI_API_KEY) {
    console.log("[LLM] Using OpenAI gpt-4o");
    return new ChatOpenAI({
      model: "gpt-4o",
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  if (process.env.ANTHROPIC_API_KEY) {
    console.log("[LLM] Using Anthropic Claude");
    return new ChatAnthropic({
      model: "claude-sonnet-4-20250514",
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  throw new Error(
    "Set up Codex auth (~/.codex/auth.json), OPENAI_API_KEY, or ANTHROPIC_API_KEY",
  );
}
