/**
 * Shopify Autopilot CLI commands
 * Registers under `bun run cli -- shopify <command>`
 */

import { Command } from "commander";

export function registerShopifyCommands(parent: Command): void {
  const shopify = parent
    .command("shopify")
    .description("Automated Shopify dropshipping business");

  shopify
    .command("setup")
    .description("Create a new Shopify store end-to-end (trial signup, theme, branding, payments)")
    .option("--store-name <name>", "Store name")
    .option("--niche <niche>", "Store niche/category")
    .action(async (args: { storeName?: string; niche?: string }) => {
      const { setupStore } = await import("./agents/store-setup");
      await setupStore(args);
    });

  shopify
    .command("source")
    .description("Find winning products from suppliers (AliExpress, CJ, Spocket)")
    .requiredOption("--niche <niche>", "Product niche to search")
    .option("--supplier <supplier>", "Supplier platform", "aliexpress")
    .option("--limit <n>", "Max products to source", "10")
    .action(async (args: { niche: string; supplier: string; limit: string }) => {
      const { sourceProducts } = await import("./agents/product-sourcer");
      await sourceProducts(args.niche, args.supplier, parseInt(args.limit));
    });

  shopify
    .command("import")
    .description("Import sourced products to Shopify store with AI descriptions + pricing")
    .option("--margin <pct>", "Target profit margin %", "30")
    .action(async (args: { margin: string }) => {
      const { importProducts } = await import("./agents/product-lister");
      await importProducts(parseInt(args.margin));
    });

  shopify
    .command("fulfill")
    .description("Auto-fulfill pending orders by placing them on the supplier")
    .option("--dry-run", "Preview orders without placing them")
    .action(async (args: { dryRun?: boolean }) => {
      const { fulfillOrders } = await import("./agents/order-fulfiller");
      await fulfillOrders(args.dryRun ?? false);
    });

  shopify
    .command("spy")
    .description("Scrape a competitor Shopify store for product intel")
    .requiredOption("--store <url>", "Competitor store URL")
    .action(async (args: { store: string }) => {
      const { spyCompetitor } = await import("./agents/competitor-spy");
      await spyCompetitor(args.store);
    });

  shopify
    .command("serve")
    .description("Start webhook server to auto-process incoming Shopify orders")
    .option("--port <port>", "Server port", "3212")
    .action(async (args: { port: string }) => {
      const { startWebhookServer } = await import("./server");
      await startWebhookServer(parseInt(args.port));
    });

  shopify
    .command("run-all")
    .description("Run full pipeline: setup → source → import → serve")
    .option("--store-name <name>", "Store name")
    .option("--niche <niche>", "Store niche/category", "general")
    .option("--supplier <supplier>", "Supplier platform", "aliexpress")
    .option("--limit <n>", "Max products to source", "10")
    .option("--margin <pct>", "Target profit margin %", "30")
    .option("--port <port>", "Webhook server port", "3212")
    .action(async (args: {
      storeName?: string;
      niche: string;
      supplier: string;
      limit: string;
      margin: string;
      port: string;
    }) => {
      const { setupStore } = await import("./agents/store-setup");
      const { sourceProducts } = await import("./agents/product-sourcer");
      const { importProducts } = await import("./agents/product-lister");
      const { startWebhookServer } = await import("./server");

      console.log("\n=== Shopify Autopilot ===\n");

      console.log("[1/4] Setting up store...");
      await setupStore({ storeName: args.storeName, niche: args.niche });

      console.log("[2/4] Sourcing products...");
      await sourceProducts(args.niche, args.supplier, parseInt(args.limit));

      console.log("[3/4] Importing products...");
      await importProducts(parseInt(args.margin));

      console.log("[4/4] Starting fulfillment server...");
      await startWebhookServer(parseInt(args.port));
    });

  shopify
    .command("dashboard")
    .description("Launch multi-agent dashboard with live browser views")
    .option("--port <port>", "Dashboard port", "3456")
    .action(async (args: { port: string }) => {
      process.env.DASHBOARD_PORT = args.port;
      await import("./dashboard/server");
    });
}
