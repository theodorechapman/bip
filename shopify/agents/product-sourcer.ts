/**
 * Product Sourcer Agent
 * Real CJ Dropshipping API integration for finding winning products.
 * Searches, scores, and filters products by margin potential and shipping time.
 * Saves results to config/products.json.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  searchProducts as cjSearch,
  scoreProduct,
  getShippingEstimate,
} from "../../scenarios/sourcing/cj-client";
import type {
  SourcedProduct,
  SourcingQuery,
} from "../../scenarios/sourcing/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, "..", "config");
const PRODUCTS_PATH = join(CONFIG_DIR, "products.json");

export type { SourcedProduct };

/**
 * Source products from CJ Dropshipping.
 * Searches by keywords, scores and ranks results, filters out bad candidates.
 */
export async function sourceProducts(input?: {
  keywords?: string[];
  category?: string;
  maxResults?: number;
  maxPriceUsd?: number;
  minMarginPct?: number;
  maxShippingDays?: number;
}): Promise<SourcedProduct[]> {
  const keywords = input?.keywords ?? ["trending", "gadget"];
  const maxResults = input?.maxResults ?? 10;
  const minMarginPct = input?.minMarginPct ?? 40;
  const maxShippingDays = input?.maxShippingDays ?? 20;
  const maxPriceUsd = input?.maxPriceUsd;

  console.log(`[sourcer] searching CJ for: ${keywords.join(", ")}`);

  const query: SourcingQuery = {
    keywords,
    category: input?.category,
    maxPriceUsd,
    minMarginPct,
  };

  // search CJ API
  const rawProducts = await cjSearch(query);
  console.log(`[sourcer] found ${rawProducts.length} raw products`);

  // score and filter
  const scored = rawProducts
    .map((p) => ({ product: p, score: scoreProduct(p, minMarginPct) }))
    .filter(({ product }) => {
      // filter out products with shipping too slow
      if (product.shippingEstimateDays > maxShippingDays) return false;
      // filter out products with no images
      if (product.images.length === 0) return false;
      // filter out products with $0 price (data quality issue)
      if (product.supplierPrice <= 0) return false;
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  const products = scored.map((s) => s.product);

  console.log(
    `[sourcer] ${products.length} products passed filters (top scores: ${scored.slice(0, 3).map((s) => s.score).join(", ")})`,
  );

  // try to get shipping estimates for top products (best effort)
  for (const product of products.slice(0, 5)) {
    try {
      const estimate = await getShippingEstimate({
        productId: product.supplierId,
        destinationCountry: "US",
      });
      product.shippingEstimateDays = estimate.shippingDays;
    } catch {
      // keep the default estimate from search results
    }
  }

  // save to config
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2));
  console.log(`[sourcer] saved ${products.length} products to ${PRODUCTS_PATH}`);

  return products;
}
