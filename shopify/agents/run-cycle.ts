/**
 * Full autonomous dropshipping cycle orchestrator.
 *
 * Pipeline:
 * 1. Source — find trending products via CJ API
 * 2. List — create Shopify listings with LLM-enhanced copy + images
 * 3. Promote — generate social content + post to X
 * 4. Fulfill — check for new orders, place with CJ, update Shopify
 */

import { sourceProducts } from "./product-sourcer";
import { importProducts, type ProductMapping } from "./product-lister";
import { fulfillOrders, type FulfillmentResult } from "./order-fulfiller";
import { loadXAccountConfig } from "./x-setup";
import { runDropshipContentCycleWithSkill } from "../../scenarios/dropship/orchestrator";
import type { DropshipProduct, DropshipCycleResult } from "../../scenarios/dropship/orchestrator";
import type { SourcedProduct } from "../../scenarios/sourcing/types";

export type CycleResult = {
  sourcing: {
    productsFound: number;
    products: SourcedProduct[];
  };
  listing: {
    productsListed: number;
    mappings: ProductMapping[];
  };
  promotion?: {
    postsCreated: number;
    postsFailed: number;
    result: DropshipCycleResult;
  };
  fulfillment: {
    ordersFulfilled: number;
    ordersErrored: number;
    results: FulfillmentResult[];
  };
  dryRun: boolean;
  durationMs: number;
};

/**
 * Run the full autonomous dropshipping cycle.
 *
 * Each stage can be individually skipped for partial runs.
 */
export async function runFullCycle(input?: {
  sourcingKeywords?: string[];
  maxProducts?: number;
  marginPct?: number;
  skipSourcing?: boolean;
  skipListing?: boolean;
  skipPromotion?: boolean;
  skipFulfillment?: boolean;
  dryRun?: boolean;
  // promotion config
  skillId?: string;
  profileId?: string;
}): Promise<CycleResult> {
  const startTime = Date.now();
  const dryRun = input?.dryRun ?? false;

  console.log(
    `\n=== dropship cycle ${dryRun ? "[DRY RUN] " : ""}===\n`,
  );

  // stage 1: source products
  let sourcedProducts: SourcedProduct[] = [];
  if (!input?.skipSourcing) {
    console.log("[cycle] stage 1/4: sourcing products...");
    sourcedProducts = await sourceProducts({
      keywords: input?.sourcingKeywords ?? ["trending", "gadget"],
      maxResults: input?.maxProducts ?? 10,
    });
    console.log(`[cycle] sourced ${sourcedProducts.length} products\n`);
  } else {
    console.log("[cycle] stage 1/4: skipping sourcing\n");
  }

  // stage 2: list on Shopify
  let mappings: ProductMapping[] = [];
  if (!input?.skipListing) {
    console.log("[cycle] stage 2/4: listing products on shopify...");
    mappings = await importProducts(dryRun, input?.marginPct ?? 50);
    console.log(`[cycle] listed ${mappings.length} products\n`);
  } else {
    console.log("[cycle] stage 2/4: skipping listing\n");
  }

  // stage 3: promote on social media
  let promotionResult: DropshipCycleResult | undefined;

  // resolve skillId/profileId: CLI flags > saved config > skip
  let skillId = input?.skillId;
  let profileId = input?.profileId;

  if (!skillId || !profileId) {
    const savedConfig = loadXAccountConfig();
    if (savedConfig) {
      skillId = skillId ?? savedConfig.skillId;
      profileId = profileId ?? savedConfig.profileId;
      if (skillId && profileId) {
        console.log(`[cycle] loaded X account config (profile: ${profileId}, skill: ${skillId})`);
      }
    }
  }

  if (!input?.skipPromotion && skillId && profileId) {
    console.log("[cycle] stage 3/4: promoting products on X...");

    // convert sourced products to dropship format
    const dropshipProducts: DropshipProduct[] = sourcedProducts
      .slice(0, 5) // promote top 5 at most
      .map((p) => ({
        name: p.name,
        category: p.category,
        description: p.description,
      }));

    if (dropshipProducts.length > 0 && !dryRun) {
      promotionResult = await runDropshipContentCycleWithSkill({
        products: dropshipProducts,
        skillId,
        profileId,
      });
      console.log(
        `[cycle] promoted: ${promotionResult.summary.succeeded}/${promotionResult.summary.total} posts\n`,
      );
    } else {
      console.log(
        `[cycle] ${dryRun ? "[DRY RUN] would promote" : "no products to promote"}\n`,
      );
    }
  } else if (!input?.skipPromotion) {
    console.log(
      `[cycle] stage 3/4: skipping promotion — no X account configured.\n` +
      `[cycle]   run 'shopify x-setup' to auto-provision, or pass --skill-id and --profile-id.\n`,
    );
  } else {
    console.log("[cycle] stage 3/4: skipping promotion (--skip-promotion)\n");
  }

  // stage 4: fulfill orders
  let fulfillmentResults: FulfillmentResult[] = [];
  if (!input?.skipFulfillment) {
    console.log("[cycle] stage 4/4: fulfilling orders...");
    fulfillmentResults = await fulfillOrders(dryRun);
    console.log(
      `[cycle] fulfillment: ${fulfillmentResults.filter((r) => r.status === "fulfilled").length} fulfilled\n`,
    );
  } else {
    console.log("[cycle] stage 4/4: skipping fulfillment\n");
  }

  const durationMs = Date.now() - startTime;
  const fulfilled = fulfillmentResults.filter(
    (r) => r.status === "fulfilled",
  ).length;
  const errored = fulfillmentResults.filter(
    (r) => r.status === "error",
  ).length;

  const result: CycleResult = {
    sourcing: {
      productsFound: sourcedProducts.length,
      products: sourcedProducts,
    },
    listing: {
      productsListed: mappings.length,
      mappings,
    },
    promotion: promotionResult
      ? {
          postsCreated: promotionResult.summary.succeeded,
          postsFailed: promotionResult.summary.failed,
          result: promotionResult,
        }
      : undefined,
    fulfillment: {
      ordersFulfilled: fulfilled,
      ordersErrored: errored,
      results: fulfillmentResults,
    },
    dryRun,
    durationMs,
  };

  console.log(`=== cycle complete in ${(durationMs / 1000).toFixed(1)}s ===\n`);

  return result;
}
