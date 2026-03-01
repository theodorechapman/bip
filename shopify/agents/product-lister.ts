/**
 * Product Lister Agent
 * Reads sourced products and creates Shopify listings with LLM-enhanced copy.
 * Uses Shopify Admin API + Claude for product descriptions.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createProduct } from "../api/products";
import { generateProductCopy } from "../../scenarios/content/generate-copy";
import type { SourcedProduct } from "../../scenarios/sourcing/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, "..", "config");
const PRODUCTS_PATH = join(CONFIG_DIR, "products.json");
const MAPPING_PATH = join(CONFIG_DIR, "product-mapping.json");

export type ProductMapping = {
  shopifyProductId: number;
  shopifyHandle: string;
  cjProductId: string;
  sku: string;
  supplierPrice: number;
  retailPrice: number;
  marginPct: number;
  listedAt: string;
};

/**
 * Import sourced products to Shopify with LLM-enhanced copy.
 *
 * @param dryRun - if true, prints what would be created without calling Shopify API
 * @param marginPct - target profit margin (default 50%). uses proper margin math: retail = cost / (1 - margin/100)
 */
export async function importProducts(
  dryRun: boolean = false,
  marginPct: number = 50,
): Promise<ProductMapping[]> {
  if (!existsSync(PRODUCTS_PATH)) {
    console.error("[lister] no sourced products found. run sourcer first.");
    return [];
  }

  const products: SourcedProduct[] = JSON.parse(
    readFileSync(PRODUCTS_PATH, "utf-8"),
  );

  if (products.length === 0) {
    console.log("[lister] no products to import.");
    return [];
  }

  // load existing mappings to avoid duplicates
  let existingMappings: ProductMapping[] = [];
  if (existsSync(MAPPING_PATH)) {
    existingMappings = JSON.parse(readFileSync(MAPPING_PATH, "utf-8"));
  }

  const existingCJIds = new Set(existingMappings.map((m) => m.cjProductId));
  const newProducts = products.filter(
    (p) => !existingCJIds.has(p.supplierId),
  );

  if (newProducts.length === 0) {
    console.log("[lister] all products already imported.");
    return existingMappings;
  }

  console.log(
    `[lister] importing ${newProducts.length} new products (${marginPct}% margin)${dryRun ? " [DRY RUN]" : ""}`,
  );

  const newMappings: ProductMapping[] = [];

  for (const product of newProducts) {
    try {
      // proper margin math: retail = cost / (1 - margin/100)
      // e.g., $10 cost at 50% margin = $10 / 0.5 = $20 retail
      const retailPrice = product.supplierPrice / (1 - marginPct / 100);

      console.log(
        `[lister] ${product.name} -- $${product.supplierPrice.toFixed(2)} -> $${retailPrice.toFixed(2)}`,
      );

      // generate LLM-enhanced copy
      let title = product.name;
      let description = product.description;
      let tags: string[] = [product.category];

      try {
        const copy = await generateProductCopy({
          productName: product.name,
          productCategory: product.category,
          supplierDescription: product.description,
        });
        title = copy.title;
        description = copy.description;
        tags = copy.tags.length > 0 ? copy.tags : tags;
        console.log(`[lister] LLM copy generated: "${title}"`);
      } catch (err: any) {
        console.warn(`[lister] LLM copy failed, using original: ${err?.message}`);
      }

      if (dryRun) {
        console.log(`[lister] [DRY RUN] would create: "${title}" at $${retailPrice.toFixed(2)}`);
        newMappings.push({
          shopifyProductId: 0,
          shopifyHandle: "dry-run",
          cjProductId: product.supplierId,
          sku: product.variants[0]?.sku ?? product.supplierId,
          supplierPrice: product.supplierPrice,
          retailPrice,
          marginPct,
          listedAt: new Date().toISOString(),
        });
        continue;
      }

      // create on Shopify
      const variants = product.variants.length > 0
        ? product.variants.map((v) => ({
            price: retailPrice.toFixed(2),
            sku: v.sku,
            inventory_quantity: v.inventory,
            option1: v.name || undefined,
          }))
        : [
            {
              price: retailPrice.toFixed(2),
              sku: product.supplierId,
              inventory_quantity: 100,
            },
          ];

      const images = product.images.map((src) => ({ src }));

      const result = await createProduct({
        title,
        body_html: description,
        vendor: product.supplierName,
        product_type: product.category,
        tags,
        variants,
        images,
        status: "active",
      });

      const mapping: ProductMapping = {
        shopifyProductId: result.productId,
        shopifyHandle: result.handle,
        cjProductId: product.supplierId,
        sku: product.variants[0]?.sku ?? product.supplierId,
        supplierPrice: product.supplierPrice,
        retailPrice,
        marginPct,
        listedAt: new Date().toISOString(),
      };

      newMappings.push(mapping);
      console.log(
        `[lister] created: ${result.handle} (shopify #${result.productId})`,
      );
    } catch (err: any) {
      console.error(`[lister] failed to import "${product.name}": ${err?.message}`);
    }
  }

  // merge and save mappings
  const allMappings = [...existingMappings, ...newMappings];
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(MAPPING_PATH, JSON.stringify(allMappings, null, 2));
  console.log(`[lister] saved ${allMappings.length} total mappings`);

  return allMappings;
}
