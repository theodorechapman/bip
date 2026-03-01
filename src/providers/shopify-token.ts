/**
 * Shopify admin API token extraction — uses Browser Use to create a custom app
 * in the Shopify admin and extract the admin API access token.
 */

import { getBrowserUseClient } from "../../scenarios/browser-use/client";

export async function getShopifyAdminToken(
  storeDomain: string,
  shopifyEmail: string,
  shopifyPassword: string,
): Promise<string | null> {
  console.log(`\n   Extracting Shopify admin token for ${storeDomain}...`);

  const client = getBrowserUseClient();

  let sessionId: string | undefined;
  try {
    const session = await client.sessions.create({
      keepAlive: true,
      proxyCountryCode: "us",
    });
    sessionId = session.id;
  } catch (err: any) {
    console.error("   Failed to create browser session:", err?.message);
    return null;
  }

  try {
    // ── Step 1: Log into Shopify admin ──
    console.log("   [1/3] Logging into Shopify admin...");

    const storeSlug = storeDomain
      .replace("https://", "")
      .replace("http://", "")
      .replace(".myshopify.com", "");

    const loginTask = `
You are automating Shopify admin access.

1. Go to https://admin.shopify.com/store/${storeSlug}
2. If not logged in, sign in with:
   - Email: ${shopifyEmail}
   - Password: ${shopifyPassword}
3. Wait for the admin dashboard to load
4. Report "LOGGED_IN" when you see the admin dashboard.
`.trim();

    const loginResult = await client.run(loginTask, {
      sessionId,
      allowedDomains: ["*.shopify.com", "*.myshopify.com", "*.accounts.shopify.com"],
      timeout: 180_000,
    });

    console.log(`   Login: ${String(loginResult.output ?? "").slice(0, 100)}`);

    // ── Step 2: Enable custom app development ──
    console.log("   [2/3] Enabling custom app development...");

    const enableTask = `
You are in the Shopify admin dashboard.

1. Go to Settings (gear icon at bottom of sidebar)
2. Click "Apps and sales channels" in the settings sidebar
3. Click "Develop apps" or "Develop apps for your store"
4. If you see "Allow custom app development", click it and confirm
5. If custom app development is already enabled, proceed
6. Report "APPS_ENABLED" when done.
`.trim();

    await client.run(enableTask, {
      sessionId,
      allowedDomains: ["*.shopify.com", "*.myshopify.com"],
      timeout: 180_000,
    });

    // ── Step 3: Create custom app and get token ──
    console.log("   [3/3] Creating custom app and extracting token...");

    const tokenTask = `
You are in the Shopify admin, in the Apps/Develop apps section.

1. Click "Create an app" (or "Create a custom app")
2. Name the app "bip-agent"
3. Click "Create app"
4. Go to "API credentials" or "Configuration" tab
5. Under "Admin API integration", click "Configure" or "Edit"
6. Select ALL admin API access scopes (check all boxes)
7. Save the configuration
8. Click "Install app" and confirm the installation
9. After installing, you should see the "Admin API access token"
10. Click "Reveal token once" to see the token
11. IMPORTANT: Copy the full token value (starts with "shpat_")
12. Return ONLY the token string as your final answer

WARNING: The token is only shown once. Make sure to copy it before navigating away.
`.trim();

    const tokenResult = await client.run(tokenTask, {
      sessionId,
      allowedDomains: ["*.shopify.com", "*.myshopify.com"],
      timeout: 300_000,
    });

    const tokenOutput = String(tokenResult.output ?? "");
    console.log(`   Token result: ${tokenOutput.slice(0, 100)}`);

    // Extract the access token
    const tokenMatch = tokenOutput.match(/shpat_[a-zA-Z0-9_-]+/);
    if (tokenMatch) {
      console.log("   Admin API token obtained successfully");
      return tokenMatch[0];
    }

    console.log("   Could not extract token from output");
    return null;
  } catch (e: any) {
    console.error("   Error:", e?.message ?? e);
    return null;
  } finally {
    if (sessionId) {
      try {
        await client.sessions.stop(sessionId);
      } catch {
        // best-effort cleanup
      }
    }
  }
}
