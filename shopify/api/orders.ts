/**
 * Shopify Admin API — Orders and modern fulfillment flow.
 * Uses fulfillment_orders (not legacy fulfillments endpoint).
 */

import { shopifyFetch, buildQuery } from "./client";

export type ShopifyOrder = {
  id: number;
  order_number: number;
  name: string;
  email: string;
  total_price: string;
  financial_status: string;
  fulfillment_status: string | null;
  created_at: string;
  line_items: Array<{
    id: number;
    title: string;
    quantity: number;
    price: string;
    sku: string;
    variant_id: number;
    product_id: number;
  }>;
  shipping_address?: {
    first_name: string;
    last_name: string;
    address1: string;
    address2: string;
    city: string;
    province: string;
    zip: string;
    country_code: string;
    phone: string;
  };
};

export type FulfillmentOrder = {
  id: number;
  order_id: number;
  status: string;
  assigned_location_id: number;
  line_items: Array<{
    id: number;
    shop_id: number;
    fulfillment_order_id: number;
    quantity: number;
    line_item_id: number;
    inventory_item_id: number;
    fulfillable_quantity: number;
    variant_id: number;
  }>;
};

/**
 * List orders with optional filters.
 */
export async function listOrders(params?: {
  status?: "open" | "closed" | "any";
  fulfillment_status?: "unfulfilled" | "fulfilled" | "partial" | "any";
  limit?: number;
}): Promise<ShopifyOrder[]> {
  const query = buildQuery({
    status: params?.status ?? "open",
    fulfillment_status: params?.fulfillment_status,
    limit: params?.limit ?? 50,
  });

  const data = await shopifyFetch<{ orders: ShopifyOrder[] }>(
    `/orders.json${query}`,
  );

  return data.orders;
}

/**
 * Get a single order by ID.
 */
export async function getOrder(orderId: number): Promise<ShopifyOrder> {
  const data = await shopifyFetch<{ order: ShopifyOrder }>(
    `/orders/${orderId}.json`,
  );

  return data.order;
}

/**
 * Get fulfillment orders for an order (modern flow).
 */
export async function getFulfillmentOrders(
  orderId: number,
): Promise<FulfillmentOrder[]> {
  const data = await shopifyFetch<{
    fulfillment_orders: FulfillmentOrder[];
  }>(`/orders/${orderId}/fulfillment_orders.json`);

  return data.fulfillment_orders;
}

/**
 * Fulfill an order using the modern fulfillment_orders flow.
 *
 * Flow:
 * 1. GET /orders/{id}/fulfillment_orders.json — get fulfillment order IDs
 * 2. POST /fulfillments.json — create fulfillment with tracking info
 */
export async function fulfillOrder(input: {
  orderId: number;
  trackingNumber?: string;
  trackingCompany?: string;
  trackingUrl?: string;
}): Promise<{ fulfillmentId: number; status: string }> {
  // step 1: get fulfillment orders
  const fulfillmentOrders = await getFulfillmentOrders(input.orderId);

  const openFO = fulfillmentOrders.find(
    (fo) => fo.status === "open" || fo.status === "in_progress",
  );

  if (!openFO) {
    throw new Error(
      `no_open_fulfillment_order for order ${input.orderId}. ` +
        `Statuses: ${fulfillmentOrders.map((fo) => fo.status).join(", ")}`,
    );
  }

  // step 2: create fulfillment
  const lineItemsByFulfillmentOrder = [
    {
      fulfillment_order_id: openFO.id,
      fulfillment_order_line_items: openFO.line_items.map((li) => ({
        id: li.id,
        quantity: li.fulfillable_quantity,
      })),
    },
  ];

  const trackingInfo: any = {};
  if (input.trackingNumber) trackingInfo.number = input.trackingNumber;
  if (input.trackingCompany) trackingInfo.company = input.trackingCompany;
  if (input.trackingUrl) trackingInfo.url = input.trackingUrl;

  const payload = {
    fulfillment: {
      line_items_by_fulfillment_order: lineItemsByFulfillmentOrder,
      ...(Object.keys(trackingInfo).length > 0 && {
        tracking_info: trackingInfo,
      }),
    },
  };

  const data = await shopifyFetch<{
    fulfillment: { id: number; status: string };
  }>("/fulfillments.json", {
    method: "POST",
    body: payload,
  });

  return {
    fulfillmentId: data.fulfillment.id,
    status: data.fulfillment.status,
  };
}
