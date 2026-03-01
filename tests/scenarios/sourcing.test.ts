/**
 * Tests for CJ Dropshipping client and sourcing logic.
 */

import { test, expect, describe, beforeEach, mock } from "bun:test";
import {
  scoreProduct,
  _resetTokenCache,
} from "../../scenarios/sourcing/cj-client";
import type { SourcedProduct, SourcingQuery } from "../../scenarios/sourcing/types";

// --- scoreProduct tests (pure logic, no API calls) ---

describe("scoreProduct", () => {
  function makeProduct(overrides: Partial<SourcedProduct> = {}): SourcedProduct {
    return {
      supplierId: "test-123",
      supplierName: "CJ Dropshipping",
      name: "Test Product",
      description: "A test product",
      category: "Electronics",
      supplierPrice: 15,
      images: ["https://img1.jpg", "https://img2.jpg", "https://img3.jpg"],
      variants: [
        { sku: "SKU-1", name: "Default", price: 15, inventory: 50 },
      ],
      shippingEstimateDays: 10,
      sourceUrl: "https://cjdropshipping.com/product/test-123",
      ...overrides,
    };
  }

  test("scores a good product highly", () => {
    const product = makeProduct({
      supplierPrice: 20,
      images: ["a", "b", "c", "d", "e"],
      shippingEstimateDays: 5,
      variants: [
        { sku: "1", name: "A", price: 20, inventory: 100 },
        { sku: "2", name: "B", price: 20, inventory: 50 },
      ],
    });

    const score = scoreProduct(product);
    // should get: 30 (price) + 30 (shipping <=7) + 20 (5+ images) + 10 (variants) + 10 (all in stock) = 100
    expect(score).toBe(100);
  });

  test("penalizes slow shipping", () => {
    const fast = makeProduct({ shippingEstimateDays: 5 });
    const slow = makeProduct({ shippingEstimateDays: 25 });

    expect(scoreProduct(fast)).toBeGreaterThan(scoreProduct(slow));
  });

  test("penalizes few images", () => {
    const manyImages = makeProduct({
      images: ["a", "b", "c", "d", "e"],
    });
    const noImages = makeProduct({ images: [] });

    expect(scoreProduct(manyImages)).toBeGreaterThan(scoreProduct(noImages));
  });

  test("handles products with no variants", () => {
    const product = makeProduct({ variants: [] });
    const score = scoreProduct(product);
    // should not crash, just lower score
    expect(score).toBeGreaterThanOrEqual(0);
  });

  test("scores cheap products lower than sweet spot", () => {
    const cheap = makeProduct({ supplierPrice: 2 });
    const sweetSpot = makeProduct({ supplierPrice: 20 });

    expect(scoreProduct(sweetSpot)).toBeGreaterThan(scoreProduct(cheap));
  });

  test("scores expensive products lower than sweet spot", () => {
    const expensive = makeProduct({ supplierPrice: 100 });
    const sweetSpot = makeProduct({ supplierPrice: 20 });

    expect(scoreProduct(sweetSpot)).toBeGreaterThan(scoreProduct(expensive));
  });
});

// --- CJ API token caching tests ---

describe("CJ token caching", () => {
  beforeEach(() => {
    _resetTokenCache();
  });

  test("_resetTokenCache clears the cached token", () => {
    // just verify no errors
    _resetTokenCache();
  });
});

// --- type checking ---

describe("sourcing types", () => {
  test("SourcedProduct shape is correct", () => {
    const product: SourcedProduct = {
      supplierId: "abc",
      supplierName: "CJ Dropshipping",
      name: "Widget",
      description: "A widget",
      category: "Gadgets",
      supplierPrice: 9.99,
      images: ["https://example.com/img.jpg"],
      variants: [{ sku: "W-1", name: "Blue", price: 9.99, inventory: 100 }],
      shippingEstimateDays: 12,
      sourceUrl: "https://cjdropshipping.com/product/abc",
    };

    expect(product.supplierId).toBe("abc");
    expect(product.variants).toHaveLength(1);
  });

  test("SourcingQuery shape is correct", () => {
    const query: SourcingQuery = {
      keywords: ["phone", "case"],
      category: "Accessories",
      maxPriceUsd: 25,
      minMarginPct: 50,
    };

    expect(query.keywords).toHaveLength(2);
    expect(query.minMarginPct).toBe(50);
  });
});
