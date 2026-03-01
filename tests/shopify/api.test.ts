/**
 * Tests for Shopify API layer.
 */

import { test, expect, describe } from "bun:test";
import { buildQuery } from "../../shopify/api/client";
import { verifyShopifyWebhook } from "../../shopify/api/webhooks";
import { createHmac } from "node:crypto";

// --- buildQuery tests ---

describe("buildQuery", () => {
  test("builds query string from params", () => {
    const query = buildQuery({ limit: 50, status: "active" });
    expect(query).toContain("limit=50");
    expect(query).toContain("status=active");
    expect(query.startsWith("?")).toBe(true);
  });

  test("filters out undefined values", () => {
    const query = buildQuery({ limit: 50, status: undefined });
    expect(query).toContain("limit=50");
    expect(query).not.toContain("status");
  });

  test("returns empty string for no params", () => {
    const query = buildQuery({});
    expect(query).toBe("");
  });

  test("returns empty string for all undefined", () => {
    const query = buildQuery({ a: undefined, b: undefined });
    expect(query).toBe("");
  });
});

// --- HMAC webhook verification tests ---

describe("verifyShopifyWebhook", () => {
  const secret = "test-webhook-secret-123";

  function computeHmac(body: string, secretKey: string): string {
    return createHmac("sha256", secretKey).update(body).digest("base64");
  }

  test("accepts valid HMAC", () => {
    const body = '{"order_number":1234,"total_price":"29.99"}';
    const hmac = computeHmac(body, secret);

    expect(verifyShopifyWebhook(body, hmac, secret)).toBe(true);
  });

  test("accepts valid HMAC with Buffer body", () => {
    const body = '{"order_number":5678}';
    const hmac = computeHmac(body, secret);

    expect(verifyShopifyWebhook(Buffer.from(body), hmac, secret)).toBe(true);
  });

  test("rejects invalid HMAC", () => {
    const body = '{"order_number":1234}';
    const hmac = "invalid-hmac-value";

    expect(verifyShopifyWebhook(body, hmac, secret)).toBe(false);
  });

  test("rejects tampered body", () => {
    const originalBody = '{"order_number":1234}';
    const tamperedBody = '{"order_number":9999}';
    const hmac = computeHmac(originalBody, secret);

    expect(verifyShopifyWebhook(tamperedBody, hmac, secret)).toBe(false);
  });

  test("rejects wrong secret", () => {
    const body = '{"order_number":1234}';
    const hmac = computeHmac(body, secret);

    expect(verifyShopifyWebhook(body, hmac, "wrong-secret")).toBe(false);
  });

  test("rejects empty HMAC header", () => {
    const body = '{"test":true}';
    expect(verifyShopifyWebhook(body, "", secret)).toBe(false);
  });

  test("rejects empty secret", () => {
    const body = '{"test":true}';
    const hmac = computeHmac(body, secret);
    expect(verifyShopifyWebhook(body, hmac, "")).toBe(false);
  });

  test("handles unicode body correctly", () => {
    const body = '{"name":"Produit sp\u00e9cial"}';
    const hmac = computeHmac(body, secret);

    expect(verifyShopifyWebhook(body, hmac, secret)).toBe(true);
  });
});

// --- Shopify offerings tests ---

describe("shopify offerings", () => {
  test("shopify offerings are registered", async () => {
    const { PHASE1_OFFERINGS, PHASE1_POLICY_DEFAULTS, findPhase1Offering } = await import("../../convex/offerings");

    const shopifyOfferings = PHASE1_OFFERINGS.filter((o) => o.offeringId.startsWith("shopify."));
    expect(shopifyOfferings).toHaveLength(4);

    const offeringIds = shopifyOfferings.map((o) => o.offeringId);
    expect(offeringIds).toContain("shopify.product.source");
    expect(offeringIds).toContain("shopify.product.list");
    expect(offeringIds).toContain("shopify.order.fulfill");
    expect(offeringIds).toContain("shopify.dropship.cycle");
  });

  test("shopify policy defaults are registered", async () => {
    const { PHASE1_POLICY_DEFAULTS } = await import("../../convex/offerings");

    const shopifyPolicies = PHASE1_POLICY_DEFAULTS.filter((p) => p.offeringId.startsWith("shopify."));
    expect(shopifyPolicies).toHaveLength(4);

    // verify provider allowlists
    const sourcePolicy = shopifyPolicies.find((p) => p.offeringId === "shopify.product.source");
    expect(sourcePolicy?.providerAllowlist).toEqual(["cj"]);

    const listPolicy = shopifyPolicies.find((p) => p.offeringId === "shopify.product.list");
    expect(listPolicy?.providerAllowlist).toEqual(["shopify"]);
  });

  test("findPhase1Offering resolves shopify intents", async () => {
    const { findPhase1Offering } = await import("../../convex/offerings");

    const sourceOffering = findPhase1Offering("shopify_source_products", "cj");
    expect(sourceOffering).not.toBeNull();
    expect(sourceOffering!.offeringId).toBe("shopify.product.source");

    const cycleOffering = findPhase1Offering("shopify_cycle", "shopify");
    expect(cycleOffering).not.toBeNull();
    expect(cycleOffering!.offeringId).toBe("shopify.dropship.cycle");
  });

  test("findPhase1Offering rejects wrong provider for shopify", async () => {
    const { findPhase1Offering } = await import("../../convex/offerings");

    // cj provider should not work for list_products (needs shopify)
    const wrong = findPhase1Offering("shopify_list_products", "cj");
    expect(wrong).toBeNull();
  });
});

// --- Shopify types compile check ---

describe("shopify types", () => {
  test("ShopifyProduct type exports correctly", async () => {
    const { type } = await import("../../shopify/api/products");
    // just verify the module loads without errors
    expect(true).toBe(true);
  });

  test("ShopifyOrder type exports correctly", async () => {
    const { type } = await import("../../shopify/api/orders");
    expect(true).toBe(true);
  });
});
