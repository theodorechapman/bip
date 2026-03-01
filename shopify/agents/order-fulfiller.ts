/**
 * Order Fulfiller Agent
 * Handles the full fulfillment loop:
 * 1. Get unfulfilled orders from Shopify
 * 2. Look up CJ product mapping
 * 3. Place order on CJ Dropshipping
 * 4. Update Shopify with tracking info
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { listOrders, fulfillOrder } from "../api/orders";
import { createCJOrder } from "../../scenarios/sourcing/cj-client";
import type { ShippingAddress } from "../../scenarios/sourcing/types";
import type { ProductMapping } from "./product-lister";
import type { ShopifyOrder } from "../api/orders";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, "..", "config");
const MAPPING_PATH = join(CONFIG_DIR, "product-mapping.json");

export type FulfillmentResult = {
  orderId: number;
  orderName: string;
  status: "fulfilled" | "cj_placed" | "skipped" | "error";
  cjOrderId?: string;
  shopifyFulfillmentId?: number;
  error?: string;
};

/**
 * Load product mapping from config.
 */
function loadProductMapping(): Map<number, ProductMapping> {
  if (!existsSync(MAPPING_PATH)) {
    console.warn("[fulfiller] no product mapping found at", MAPPING_PATH);
    return new Map();
  }

  const mappings: ProductMapping[] = JSON.parse(
    readFileSync(MAPPING_PATH, "utf-8"),
  );

  const map = new Map<number, ProductMapping>();
  for (const m of mappings) {
    map.set(m.shopifyProductId, m);
  }
  return map;
}

/**
 * Convert Shopify shipping address to CJ format.
 */
function toShippingAddress(
  addr: NonNullable<ShopifyOrder["shipping_address"]>,
): ShippingAddress {
  return {
    firstName: addr.first_name,
    lastName: addr.last_name,
    address1: addr.address1,
    address2: addr.address2 || undefined,
    city: addr.city,
    state: addr.province,
    zip: addr.zip,
    country: addr.country_code,
    phone: addr.phone || undefined,
  };
}

/**
 * Fulfill all unfulfilled orders.
 *
 * For each unfulfilled Shopify order:
 * 1. Look up the CJ product ID from our mapping
 * 2. Place the order on CJ with the customer's shipping address
 * 3. Mark the Shopify order as fulfilled (with tracking when available)
 */
export async function fulfillOrders(
  dryRun: boolean = false,
): Promise<FulfillmentResult[]> {
  console.log(
    `[fulfiller] checking for unfulfilled orders${dryRun ? " [DRY RUN]" : ""}`,
  );

  const productMapping = loadProductMapping();
  if (productMapping.size === 0 && !dryRun) {
    console.warn("[fulfiller] no product mappings loaded, can't match orders to CJ products");
  }

  // get unfulfilled orders from Shopify
  const orders = await listOrders({
    status: "open",
    fulfillment_status: "unfulfilled",
    limit: 50,
  });

  if (orders.length === 0) {
    console.log("[fulfiller] no unfulfilled orders found");
    return [];
  }

  console.log(`[fulfiller] found ${orders.length} unfulfilled orders`);

  const results: FulfillmentResult[] = [];

  for (const order of orders) {
    try {
      console.log(
        `[fulfiller] processing order ${order.name} ($${order.total_price})`,
      );

      if (!order.shipping_address) {
        console.warn(`[fulfiller] order ${order.name} has no shipping address, skipping`);
        results.push({
          orderId: order.id,
          orderName: order.name,
          status: "skipped",
          error: "no_shipping_address",
        });
        continue;
      }

      if (dryRun) {
        console.log(`[fulfiller] [DRY RUN] would fulfill order ${order.name}`);
        for (const item of order.line_items) {
          const mapping = productMapping.get(item.product_id);
          console.log(
            `[fulfiller]   - ${item.title} x${item.quantity} (CJ: ${mapping?.cjProductId ?? "unmapped"})`,
          );
        }
        results.push({
          orderId: order.id,
          orderName: order.name,
          status: "skipped",
        });
        continue;
      }

      // place orders on CJ for each line item
      let cjOrderId: string | undefined;

      for (const item of order.line_items) {
        const mapping = productMapping.get(item.product_id);
        if (!mapping) {
          console.warn(
            `[fulfiller] no CJ mapping for product ${item.product_id} (${item.title}), skipping`,
          );
          continue;
        }

        const shippingAddress = toShippingAddress(order.shipping_address!);

        const cjResult = await createCJOrder({
          productId: mapping.cjProductId,
          variantId: mapping.sku,
          quantity: item.quantity,
          shippingAddress,
        });

        cjOrderId = cjResult.orderId;
        console.log(
          `[fulfiller] CJ order placed: ${cjResult.orderId} (status: ${cjResult.status})`,
        );
      }

      // mark as fulfilled on Shopify
      // note: CJ tracking info comes later (async), so we fulfill without tracking for now
      // a separate process should poll CJ for tracking and update Shopify
      const fulfillment = await fulfillOrder({
        orderId: order.id,
        // tracking will be added later when CJ provides it
      });

      results.push({
        orderId: order.id,
        orderName: order.name,
        status: "fulfilled",
        cjOrderId,
        shopifyFulfillmentId: fulfillment.fulfillmentId,
      });

      console.log(
        `[fulfiller] order ${order.name} fulfilled (shopify #${fulfillment.fulfillmentId})`,
      );
    } catch (err: any) {
      console.error(`[fulfiller] failed to fulfill ${order.name}: ${err?.message}`);
      results.push({
        orderId: order.id,
        orderName: order.name,
        status: "error",
        error: err?.message,
      });
    }
  }

  const fulfilled = results.filter((r) => r.status === "fulfilled").length;
  console.log(
    `[fulfiller] done: ${fulfilled}/${orders.length} orders fulfilled`,
  );

  return results;
}
