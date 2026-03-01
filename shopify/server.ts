/**
 * Shopify Webhook Server
 * Receives Shopify webhooks for new orders and triggers auto-fulfillment.
 * Uses node:http so it works with both bun and tsx.
 */

import { createServer } from "node:http";
import { fulfillOrders } from "./agents/order-fulfiller";

export async function startWebhookServer(port: number) {
  console.log(`\n   Starting Shopify webhook server on port ${port}\n`);

  const server = createServer(async (req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    if (url === "/health" && method === "GET") {
      res.writeHead(200);
      res.end("ok");
      return;
    }

    // Parse JSON body for POST routes
    if (method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString());

      if (url === "/webhooks/orders/create") {
        const hmac = req.headers["x-shopify-hmac-sha256"];
        if (!hmac) {
          res.writeHead(401);
          res.end("Unauthorized");
          return;
        }

        // TODO: verify HMAC with shared secret
        console.log(`   New order: #${body.order_number} — $${body.total_price}`);

        fulfillOrders(false).catch((err) =>
          console.error("Fulfillment error:", err),
        );

        res.writeHead(200);
        res.end("ok");
        return;
      }

      if (url === "/webhooks/orders/fulfilled") {
        console.log(`   Order fulfilled: #${body.order_number}`);
        res.writeHead(200);
        res.end("ok");
        return;
      }
    }

    res.writeHead(404);
    res.end("not found");
  });

  server.listen(port, () => {
    console.log(`   Listening for Shopify webhooks...`);
    console.log(`   POST /webhooks/orders/create  -> auto-fulfill`);
    console.log(`   POST /webhooks/orders/fulfilled -> log\n`);
  });
}
