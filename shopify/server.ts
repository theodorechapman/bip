/// <reference types="bun-types" />
/**
 * Shopify Webhook Server
 * Receives Shopify webhooks for new orders and triggers auto-fulfillment.
 * Real HMAC verification via SHA256.
 *
 * Uses Bun.serve() per project convention.
 */

import { fulfillOrders } from "./agents/order-fulfiller";
import { verifyShopifyWebhook } from "./api/webhooks";

export async function startWebhookServer(port: number) {
  const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error(
      "[server] SHOPIFY_WEBHOOK_SECRET not set — all webhooks will be rejected",
    );
  }

  console.log(`[server] starting Shopify webhook server on port ${port}`);

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // Health check
      if (path === "/health" && req.method === "GET") {
        return new Response("ok", { status: 200 });
      }

      if (req.method === "POST") {
        // Collect raw body for HMAC verification
        const rawBody = await req.text();

        // HMAC verification required
        if (!webhookSecret) {
          console.warn(
            `[server] rejecting webhook ${path}: no SHOPIFY_WEBHOOK_SECRET configured`,
          );
          return new Response("webhook secret not configured", { status: 500 });
        }

        const hmac = req.headers.get("x-shopify-hmac-sha256") ?? "";
        if (!hmac || !verifyShopifyWebhook(rawBody, hmac, webhookSecret)) {
          console.warn(`[server] HMAC verification failed for ${path}`);
          return new Response("unauthorized", { status: 401 });
        }

        let body: any;
        try {
          body = JSON.parse(rawBody);
        } catch (parseErr: any) {
          console.error(
            `[server] JSON parse error for ${path}: ${parseErr?.message}`,
          );
          return new Response("invalid json", { status: 400 });
        }

        if (path === "/webhooks/orders/create") {
          console.log(
            `[server] new order: #${body.order_number} -- $${body.total_price}`,
          );

          fulfillOrders(false).catch((err) =>
            console.error("[server] fulfillment error:", err),
          );

          return new Response("ok", { status: 200 });
        }

        if (path === "/webhooks/orders/fulfilled") {
          console.log(`[server] order fulfilled: #${body.order_number}`);
          return new Response("ok", { status: 200 });
        }
      }

      return new Response("not found", { status: 404 });
    },
  });

  console.log(`[server] listening for Shopify webhooks on :${port}`);
  console.log(`[server] POST /webhooks/orders/create  -> auto-fulfill`);
  console.log(`[server] POST /webhooks/orders/fulfilled -> log`);

  return server;
}
