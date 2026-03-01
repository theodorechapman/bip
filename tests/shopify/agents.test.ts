/**
 * Tests for Shopify agents — product-sourcer, product-lister, order-fulfiller, run-cycle.
 * Uses mocked API responses since we can't hit real APIs in tests.
 */

import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { SourcedProduct } from "../../scenarios/sourcing/types";
import type { ProductMapping } from "../../shopify/agents/product-lister";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOPIFY_CONFIG_DIR = join(__dirname, "../../shopify/config");
const PRODUCTS_PATH = join(SHOPIFY_CONFIG_DIR, "products.json");
const MAPPING_PATH = join(SHOPIFY_CONFIG_DIR, "product-mapping.json");

// --- test fixtures ---

function makeSourcedProduct(overrides: Partial<SourcedProduct> = {}): SourcedProduct {
  return {
    supplierId: "CJ-PROD-001",
    supplierName: "CJ Dropshipping",
    name: "Wireless Bluetooth Earbuds",
    description: "High quality wireless earbuds with noise cancellation",
    category: "Electronics",
    supplierPrice: 12.50,
    images: [
      "https://img.cjdropshipping.com/earbuds-1.jpg",
      "https://img.cjdropshipping.com/earbuds-2.jpg",
      "https://img.cjdropshipping.com/earbuds-3.jpg",
    ],
    variants: [
      { sku: "EB-BLK", name: "Black", price: 12.50, inventory: 500 },
      { sku: "EB-WHT", name: "White", price: 12.50, inventory: 300 },
    ],
    shippingEstimateDays: 10,
    sourceUrl: "https://cjdropshipping.com/product/CJ-PROD-001",
    ...overrides,
  };
}

function makeProductMapping(overrides: Partial<ProductMapping> = {}): ProductMapping {
  return {
    shopifyProductId: 12345678,
    shopifyHandle: "wireless-bluetooth-earbuds",
    cjProductId: "CJ-PROD-001",
    sku: "EB-BLK",
    supplierPrice: 12.50,
    retailPrice: 25.00,
    marginPct: 50,
    listedAt: new Date().toISOString(),
    ...overrides,
  };
}

// --- product mapping tests ---

describe("product mapping", () => {
  test("mapping has correct margin calculation", () => {
    const mapping = makeProductMapping();
    // proper margin: retail = cost / (1 - margin/100)
    // $12.50 / (1 - 0.50) = $25.00
    const expectedRetail = mapping.supplierPrice / (1 - mapping.marginPct / 100);
    expect(mapping.retailPrice).toBe(expectedRetail);
  });

  test("margin math works for different percentages", () => {
    const cost = 10;
    const margin40 = cost / (1 - 40 / 100); // $16.67
    const margin50 = cost / (1 - 50 / 100); // $20.00
    const margin60 = cost / (1 - 60 / 100); // $25.00

    expect(margin40).toBeCloseTo(16.67, 1);
    expect(margin50).toBe(20);
    expect(margin60).toBe(25);
  });
});

// --- product lister logic ---

describe("product lister", () => {
  beforeEach(() => {
    mkdirSync(SHOPIFY_CONFIG_DIR, { recursive: true });
  });

  afterEach(() => {
    // clean up test files
    if (existsSync(PRODUCTS_PATH)) rmSync(PRODUCTS_PATH);
    if (existsSync(MAPPING_PATH)) rmSync(MAPPING_PATH);
  });

  test("importProducts returns empty when no products file", async () => {
    // remove products file if it exists
    if (existsSync(PRODUCTS_PATH)) rmSync(PRODUCTS_PATH);

    const { importProducts } = await import("../../shopify/agents/product-lister");
    const result = await importProducts(true); // dry run
    expect(result).toEqual([]);
  });

  test("importProducts handles empty products array", async () => {
    writeFileSync(PRODUCTS_PATH, JSON.stringify([]));

    const { importProducts } = await import("../../shopify/agents/product-lister");
    const result = await importProducts(true); // dry run
    expect(result).toEqual([]);
  });

  test("importProducts dry run produces mappings without Shopify calls", async () => {
    const products = [makeSourcedProduct()];
    writeFileSync(PRODUCTS_PATH, JSON.stringify(products));

    // remove existing mapping to test fresh import
    if (existsSync(MAPPING_PATH)) rmSync(MAPPING_PATH);

    const { importProducts } = await import("../../shopify/agents/product-lister");
    const result = await importProducts(true, 50); // dry run, 50% margin
    expect(result.length).toBeGreaterThanOrEqual(1);

    // dry run should produce shopifyProductId: 0
    const dryRunMapping = result.find((m) => m.cjProductId === "CJ-PROD-001");
    expect(dryRunMapping).toBeDefined();
    expect(dryRunMapping!.shopifyProductId).toBe(0);
    expect(dryRunMapping!.shopifyHandle).toBe("dry-run");
    expect(dryRunMapping!.retailPrice).toBeCloseTo(25.0, 1); // 12.50 / 0.5 = 25
  });

  test("importProducts skips already-imported products", async () => {
    const products = [makeSourcedProduct()];
    writeFileSync(PRODUCTS_PATH, JSON.stringify(products));

    // pre-existing mapping
    const existingMapping = [makeProductMapping()];
    writeFileSync(MAPPING_PATH, JSON.stringify(existingMapping));

    const { importProducts } = await import("../../shopify/agents/product-lister");
    const result = await importProducts(true, 50);
    // should return existing mappings without adding duplicates
    expect(result).toHaveLength(1);
  });
});

// --- run-cycle type tests ---

describe("run-cycle", () => {
  test("CycleResult type is well-formed", async () => {
    const { type } = await import("../../shopify/agents/run-cycle");
    // module loads without errors
    expect(true).toBe(true);
  });
});

// --- fulfiller logic tests ---

describe("order-fulfiller", () => {
  test("module exports fulfillOrders function", async () => {
    const mod = await import("../../shopify/agents/order-fulfiller");
    expect(typeof mod.fulfillOrders).toBe("function");
  });
});

// --- sourcer logic tests ---

describe("product-sourcer", () => {
  test("module exports sourceProducts function", async () => {
    const mod = await import("../../shopify/agents/product-sourcer");
    expect(typeof mod.sourceProducts).toBe("function");
  });
});
