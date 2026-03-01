/**
 * LLM-powered copy generation for product descriptions and social posts.
 * Uses Claude for natural, non-AI-sounding marketing copy.
 */

import type {
  GenerateCopyInput,
  GenerateCopyResult,
  GenerateSocialPostInput,
  GenerateSocialPostResult,
} from "./types";
import {
  PRODUCT_COPY_SYSTEM,
  PRODUCT_COPY_USER,
  SOCIAL_POST_SYSTEM,
  SOCIAL_POST_USER,
} from "../dropship/prompts";

function getAnthropicApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  return key;
}

async function callClaude(
  system: string,
  userMessage: string,
): Promise<string> {
  const apiKey = getAnthropicApiKey();

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown");
    throw new Error(`claude_http_${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as any;
  const textBlock = data?.content?.find((b: any) => b.type === "text");
  if (!textBlock?.text) {
    throw new Error("claude_empty_response");
  }

  return textBlock.text;
}

function parseJsonFromResponse(raw: string): any {
  // claude sometimes wraps JSON in markdown code blocks
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const cleaned = jsonMatch ? jsonMatch[1].trim() : raw.trim();
  return JSON.parse(cleaned);
}

/**
 * Generate product copy: title, description, and tags.
 */
export async function generateProductCopy(
  input: GenerateCopyInput,
): Promise<GenerateCopyResult> {
  const userMessage = PRODUCT_COPY_USER(input);
  const raw = await callClaude(PRODUCT_COPY_SYSTEM, userMessage);

  try {
    const parsed = parseJsonFromResponse(raw);
    return {
      title: parsed.title ?? input.productName,
      description: parsed.description ?? input.supplierDescription,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    };
  } catch {
    // if JSON parsing fails, use the raw text as description
    return {
      title: input.productName,
      description: raw.slice(0, 500),
      tags: [],
    };
  }
}

/**
 * Generate a social media post for a product.
 */
export async function generateSocialPost(
  input: GenerateSocialPostInput,
): Promise<GenerateSocialPostResult> {
  const userMessage = SOCIAL_POST_USER(input);
  const raw = await callClaude(SOCIAL_POST_SYSTEM, userMessage);

  try {
    const parsed = parseJsonFromResponse(raw);
    return {
      text: parsed.text ?? raw.slice(0, 280),
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
    };
  } catch {
    // extract hashtags from raw text
    const hashtags = (raw.match(/#\w+/g) ?? []).map((h: string) =>
      h.replace("#", ""),
    );
    const text = raw.replace(/#\w+/g, "").trim().slice(0, 280);
    return { text, hashtags };
  }
}
