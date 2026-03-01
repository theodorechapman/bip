/**
 * Product Lister Agent
 * Takes sourced products and lists them on the Shopify store:
 * - Generates SEO-optimized titles and descriptions via LLM
 * - Calculates retail price based on margin target
 * - Uploads images
 * - Creates product listings via Shopify Admin API
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { SourcedProduct } from "./product-sourcer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRODUCTS_PATH = join(__dirname, "..", "config", "products.json");
const STORE_PATH = join(__dirname, "..", "config", "store.json");

export async function importProducts(marginPct: number) {
  console.log(`\n📦 Importing products to Shopify (${marginPct}% margin)\n`);

  if (!existsSync(PRODUCTS_PATH)) {
    console.error("   No sourced products found. Run `shopify source` first.");
    process.exit(1);
  }
  if (!existsSync(STORE_PATH)) {
    console.error("   No store config found. Run `shopify setup` first.");
    process.exit(1);
  }

  const products: SourcedProduct[] = JSON.parse(
    readFileSync(PRODUCTS_PATH, "utf-8"),
  );

  if (products.length === 0) {
    console.log("   No products to import.");
    return;
  }

  for (const product of products) {
    const retailPrice = product.supplierPrice * (1 + marginPct / 100);
    console.log(
      `   ${product.title} — $${product.supplierPrice.toFixed(2)} → $${retailPrice.toFixed(2)}`,
    );

    // TODO: BrowserUse or Shopify Admin API:
    // 1. Generate product title + description via LLM
    // 2. Upload images to Shopify
    // 3. Create product with variants, pricing, inventory
    // 4. Assign to collection based on niche
  }

  console.log(`\n   ${products.length} products queued for import`);
  console.log("   ⚠️  Shopify API integration pending\n");
}
