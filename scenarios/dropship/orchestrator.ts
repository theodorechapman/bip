/**
 * Dropshipping content cycle orchestrator.
 *
 * For each product: generate copy -> generate image -> post to X.
 * Supports two posting modes:
 *   1. Intent-based: create an x_post intent -> executeIntent -> browser-use task
 *   2. Skill-based: directly execute a pre-created browser-use skill ($0.02/call)
 *
 * The skill path is way cheaper for repeated posting. Create the skill once
 * via createXPostSkill(), then pass the skillId + profileId here.
 */

import { generateProductCopy, generateSocialPost } from "../content/generate-copy";
import { generateProductImage } from "../content/generate-image";
import { executeXPostSkill } from "../browser-use/skills";
import type { ProductContent } from "../content/types";

export type DropshipProduct = {
  name: string;
  category: string;
  description: string;
  targetAudience?: string;
};

export type DropshipPostResult = {
  productName: string;
  content?: ProductContent;
  postUrl?: string;
  error?: string;
  mode?: "intent" | "skill";
  latencyMs?: number;
};

export type DropshipCycleResult = {
  posts: DropshipPostResult[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
};

/**
 * Generate content for a single product (copy + image + social post).
 * Does NOT post — just generates the content bundle.
 */
export async function generateProductContent(
  product: DropshipProduct,
): Promise<ProductContent> {
  // generate copy and image in parallel
  const [copyResult, imageResult, socialResult] = await Promise.all([
    generateProductCopy({
      productName: product.name,
      productCategory: product.category,
      supplierDescription: product.description,
      targetAudience: product.targetAudience,
    }),
    generateProductImage({
      productName: product.name,
      productDescription: product.description,
      style: "lifestyle",
    }),
    generateSocialPost({
      productName: product.name,
      productDescription: product.description,
      platform: "x",
    }),
  ]);

  return {
    name: copyResult.title,
    description: copyResult.description,
    tags: copyResult.tags,
    imageBase64: imageResult.ok ? imageResult.imageBase64 : undefined,
    socialPost: {
      text: socialResult.text,
      hashtags: socialResult.hashtags,
    },
  };
}

/**
 * Run the full dropship content cycle using the intent system.
 *
 * For each product:
 * 1. Generate product copy (Claude)
 * 2. Generate product image (Gemini)
 * 3. Generate social post text (Claude)
 * 4. Create an x_post intent via the provided callback
 *
 * The actual X posting happens through executeIntent.
 */
export async function runDropshipContentCycle(input: {
  products: DropshipProduct[];
  createXPostIntent: (post: {
    postText: string;
    imageBase64?: string;
  }) => Promise<{ intentId: string; error?: string }>;
}): Promise<DropshipCycleResult> {
  const results: DropshipPostResult[] = [];

  for (const product of input.products) {
    try {
      console.log(`[dropship] generating content for: ${product.name}`);

      const content = await generateProductContent(product);

      // build the full post text with hashtags
      const hashtagStr = content.socialPost.hashtags
        .map((h) => `#${h}`)
        .join(" ");
      const fullPostText = `${content.socialPost.text}\n\n${hashtagStr}`.trim();

      // create the intent to post
      const intentResult = await input.createXPostIntent({
        postText: fullPostText,
        imageBase64: content.imageBase64,
      });

      if (intentResult.error) {
        results.push({
          productName: product.name,
          content,
          error: intentResult.error,
          mode: "intent",
        });
      } else {
        results.push({
          productName: product.name,
          content,
          mode: "intent",
          // postUrl will be populated after executeIntent runs
        });
      }
    } catch (err: any) {
      console.error(`[dropship] failed for ${product.name}:`, err?.message);
      results.push({
        productName: product.name,
        error: err?.message ?? "unknown_error",
      });
    }
  }

  const succeeded = results.filter((r) => !r.error).length;
  return {
    posts: results,
    summary: {
      total: input.products.length,
      succeeded,
      failed: input.products.length - succeeded,
    },
  };
}

/**
 * Run the dropship content cycle using skills — the fast + cheap path.
 *
 * Requires:
 * - A pre-created X post skill (from createXPostSkill())
 * - A browser profile logged into the X account
 *
 * Each post costs ~$0.02 via skill execution vs $0.50+ for a full agent task.
 */
export async function runDropshipContentCycleWithSkill(input: {
  products: DropshipProduct[];
  skillId: string;
  profileId: string;
}): Promise<DropshipCycleResult> {
  const results: DropshipPostResult[] = [];

  for (const product of input.products) {
    try {
      console.log(`[dropship:skill] generating content for: ${product.name}`);

      const content = await generateProductContent(product);

      const hashtagStr = content.socialPost.hashtags
        .map((h) => `#${h}`)
        .join(" ");
      const fullPostText = `${content.socialPost.text}\n\n${hashtagStr}`.trim();

      // Skills require a public image URL, not base64. If we have a
      // base64 image, log that it's being skipped so it's not silent.
      if (content.imageBase64) {
        console.warn(
          `[dropship:skill] image generated for "${product.name}" but skipped — ` +
          `skill-based posts require a public image URL, not base64. ` +
          `To include images, upload to a CDN and pass the URL.`,
        );
      }

      // execute skill directly — no intent system, just fire and done
      const skillResult = await executeXPostSkill({
        skillId: input.skillId,
        tweetText: fullPostText,
        // imageUrl would go here if we had a CDN upload step
        profileId: input.profileId,
      });

      if (skillResult.ok) {
        results.push({
          productName: product.name,
          content,
          postUrl: skillResult.tweetUrl,
          mode: "skill",
          latencyMs: skillResult.latencyMs,
        });
      } else {
        results.push({
          productName: product.name,
          content,
          error: skillResult.error,
          mode: "skill",
        });
      }
    } catch (err: any) {
      console.error(`[dropship:skill] failed for ${product.name}:`, err?.message);
      results.push({
        productName: product.name,
        error: err?.message ?? "unknown_error",
        mode: "skill",
      });
    }
  }

  const succeeded = results.filter((r) => !r.error).length;
  return {
    posts: results,
    summary: {
      total: input.products.length,
      succeeded,
      failed: input.products.length - succeeded,
    },
  };
}
