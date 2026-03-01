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
    .command("register")
    .description("Register local Shopify store credentials with BIP (syncs shopify/config/store.json to your agent)")
    .action(async () => {
      const { loadConfig } = await import("./agents/store-setup");
      const { callProtectedTool } = await import("../src/cli");
      const config = loadConfig();
      if (!config?.shopifyDomain || !config?.shopifyAccessToken) {
        console.error("No store config found. Run `bip shopify setup` first.");
        process.exit(1);
      }
      const result = await callProtectedTool("/api/tools/shopify_register", {
        domain: config.shopifyDomain,
        accessToken: config.shopifyAccessToken,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  shopify
    .command("source")
    .description("Find winning products from CJ Dropshipping")
    .option("--keywords <words>", "Search keywords (comma-separated)", "trending,gadget")
    .option("--category <cat>", "Product category")
    .option("--limit <n>", "Max products to source", "10")
    .option("--max-price <usd>", "Max supplier price in USD")
    .action(async (args: { keywords: string; category?: string; limit: string; maxPrice?: string }) => {
      const { sourceProducts } = await import("./agents/product-sourcer");
      await sourceProducts({
        keywords: args.keywords.split(",").map((k) => k.trim()),
        category: args.category,
        maxResults: parseInt(args.limit),
        maxPriceUsd: args.maxPrice ? parseFloat(args.maxPrice) : undefined,
      });
    });

  shopify
    .command("import")
    .description("Import sourced products to Shopify store with AI descriptions + pricing")
    .option("--margin <pct>", "Target profit margin %", "50")
    .option("--dry-run", "Preview without creating on Shopify")
    .action(async (args: { margin: string; dryRun?: boolean }) => {
      const { importProducts } = await import("./agents/product-lister");
      await importProducts(args.dryRun ?? false, parseInt(args.margin));
    });

  shopify
    .command("fulfill")
    .description("Auto-fulfill pending orders by placing them on CJ Dropshipping")
    .option("--dry-run", "Preview orders without placing them")
    .action(async (args: { dryRun?: boolean }) => {
      const { fulfillOrders } = await import("./agents/order-fulfiller");
      await fulfillOrders(args.dryRun ?? false);
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
    .command("x-setup")
    .description("Auto-provision an X/Twitter account with browser-use profile + posting skill")
    .option("--handle <handle>", "Preferred X handle/username")
    .option("--email <email>", "Existing X account email (skip signup)")
    .option("--password <password>", "Existing X account password (skip signup)")
    .action(async (args: { handle?: string; email?: string; password?: string }) => {
      const { setupXAccount } = await import("./agents/x-setup");
      await setupXAccount({
        handle: args.handle,
        existingEmail: args.email,
        existingPassword: args.password,
      });
    });

  shopify
    .command("run-all")
    .description("Run full autonomous cycle: source -> list -> promote -> fulfill")
    .option("--keywords <words>", "Search keywords (comma-separated)", "trending,gadget")
    .option("--limit <n>", "Max products to source", "10")
    .option("--margin <pct>", "Target profit margin %", "50")
    .option("--skill-id <id>", "Browser-use X post skill ID (for promotion)")
    .option("--profile-id <id>", "Browser-use profile ID (for promotion)")
    .option("--skip-sourcing", "Skip product sourcing stage")
    .option("--skip-listing", "Skip Shopify listing stage")
    .option("--skip-promotion", "Skip social media promotion stage")
    .option("--skip-fulfillment", "Skip order fulfillment stage")
    .option("--dry-run", "Preview all stages without live API calls")
    .action(async (args: {
      keywords: string;
      limit: string;
      margin: string;
      skillId?: string;
      profileId?: string;
      skipSourcing?: boolean;
      skipListing?: boolean;
      skipPromotion?: boolean;
      skipFulfillment?: boolean;
      dryRun?: boolean;
    }) => {
      const { runFullCycle } = await import("./agents/run-cycle");

      const result = await runFullCycle({
        sourcingKeywords: args.keywords.split(",").map((k) => k.trim()),
        maxProducts: parseInt(args.limit),
        marginPct: parseInt(args.margin),
        skillId: args.skillId,
        profileId: args.profileId,
        skipSourcing: args.skipSourcing,
        skipListing: args.skipListing,
        skipPromotion: args.skipPromotion,
        skipFulfillment: args.skipFulfillment,
        dryRun: args.dryRun,
      });

      console.log("\n--- cycle summary ---");
      console.log(`sourced: ${result.sourcing.productsFound} products`);
      console.log(`listed:  ${result.listing.productsListed} products`);
      if (result.promotion) {
        console.log(`promoted: ${result.promotion.postsCreated} posts (${result.promotion.postsFailed} failed)`);
      }
      console.log(`fulfilled: ${result.fulfillment.ordersFulfilled} orders (${result.fulfillment.ordersErrored} errors)`);
      console.log(`duration: ${(result.durationMs / 1000).toFixed(1)}s`);
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
