/**
 * Store Setup Agent
 * Uses Browser Use Cloud API to create a Shopify store:
 * - Sign up for Shopify free trial
 * - Set store name, niche, basic settings
 * - Pick and customize theme
 * - Set up payment provider
 * - Add legal pages (privacy, terms, refund policy)
 *
 * Runs sequential Cloud API tasks on a shared keepAlive session.
 * Email verification handled via AgentMail polling between tasks.
 */

import { getBrowserUseClient } from "../../scenarios/browser-use/client";
import {
  createOrReuseInbox,
  getExistingMessageIds,
  waitForEmail,
  extractVerificationLink,
} from "../../src/agentmail-client";

import { randomBytes } from "node:crypto";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, "..", "config");
const CONFIG_PATH = join(CONFIG_DIR, "store.json");

export type StoreConfig = {
  storeName: string;
  niche: string;
  shopifyUrl?: string;
  shopifyAdmin?: string;
  shopifyDomain?: string;
  shopifyAccessToken?: string;
  email?: string;
  password?: string;
  setupComplete: boolean;
  createdAt: string;
};

function generatePassword(): string {
  return randomBytes(16).toString("base64url") + "!A1";
}

function saveConfig(config: StoreConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function loadConfig(): StoreConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as StoreConfig;
  } catch {
    return null;
  }
}

/**
 * Try to extract store URL from task output text.
 * Looks for *.myshopify.com patterns.
 */
function extractStoreUrl(output: unknown): { shopifyUrl?: string; shopifyAdmin?: string } {
  const text = typeof output === "string" ? output : JSON.stringify(output ?? "");

  const myshopifyMatch = text.match(
    /(?:https?:\/\/)?([a-z0-9-]+\.myshopify\.com)/i,
  );
  const adminMatch = text.match(
    /(?:https?:\/\/)?admin\.shopify\.com\/store\/([a-z0-9-]+)/i,
  );

  const shopifyUrl = myshopifyMatch
    ? `https://${myshopifyMatch[1]}`
    : undefined;
  const shopifyAdmin = adminMatch
    ? `https://admin.shopify.com/store/${adminMatch[1]}`
    : shopifyUrl
      ? `https://admin.shopify.com/store/${shopifyUrl.replace("https://", "").replace(".myshopify.com", "")}`
      : undefined;

  return { shopifyUrl, shopifyAdmin };
}

export async function setupStore(opts: { storeName?: string; niche?: string }) {
  const storeName = opts.storeName ?? `store-${Date.now()}`;
  const niche = opts.niche ?? "general";

  console.log(`\n   Setting up Shopify store: ${storeName}`);
  console.log(`   Niche: ${niche}`);

  const client = getBrowserUseClient();

  // Create agentmail inbox for Shopify signup
  const inbox = await createOrReuseInbox(false);
  const email = inbox.email || inbox.inbox_id;
  const knownIds = await getExistingMessageIds(inbox.inbox_id);
  const password = generatePassword();

  console.log(`   Email: ${email}`);

  // Create a persistent session with keepAlive so we can chain tasks
  let sessionId: string | undefined;
  let liveUrl: string | undefined;

  try {
    const session = await client.sessions.create({
      keepAlive: true,
      proxyCountryCode: "us",
    });
    sessionId = session.id;
    liveUrl = (session as any).liveUrl ?? (session as any).live_url;
    if (liveUrl) {
      console.log(`   Live view: ${liveUrl}`);
    }
  } catch (err: any) {
    console.error("   Failed to create browser session:", err?.message);
    throw new Error("BROWSER_USE_API_KEY required for store setup");
  }

  // Save partial config early so we can resume on failure
  const partialConfig: StoreConfig = {
    storeName,
    niche,
    email,
    password,
    setupComplete: false,
    createdAt: new Date().toISOString(),
  };
  saveConfig(partialConfig);

  try {
    // ── Task 1: Sign up for Shopify free trial ──
    console.log("\n   [1/3] Starting Shopify signup...");

    const signupTask = `
You are automating Shopify store creation.

STEP 1 - SIGN UP FOR SHOPIFY FREE TRIAL:
1. Go to https://www.shopify.com/free-trial
2. Click "Start free trial"
3. If clicking or typing fails, try:
   - Keyboard navigation with Tab to move between fields
   - wait(seconds=3) before interacting with elements
   - scroll_down() to ensure elements are in view
4. If asked "What are you looking to do?", select "Start an online store"
5. Answer onboarding questions based on the niche "${niche}"
6. When asked for email, enter: ${email}
7. When asked for password, enter: ${password}
8. Fill in business info: country = United States, use any US address
9. Complete the signup flow

IMPORTANT:
- Be patient with page loads
- If you see CAPTCHAs, try to solve them
- Skip optional steps that block progress
- After signup is complete, report what URL you ended up on
`.trim();

    const signupResult = await client.run(signupTask, {
      sessionId,
      allowedDomains: ["*.shopify.com", "*.myshopify.com", "*.accounts.shopify.com"],
      timeout: 300_000,
    });

    console.log("   Signup task completed");
    if (signupResult.output) {
      console.log(`   Output: ${String(signupResult.output).slice(0, 200)}`);
    }

    // ── Email verification ──
    console.log("\n   [2/3] Checking for verification email...");

    const msg = await waitForEmail(inbox.inbox_id, knownIds, 120, 3);
    if (msg) {
      const link = extractVerificationLink(msg);
      if (link) {
        console.log("   Found verification link, clicking...");

        const verifyTask = `
Navigate to this verification link and complete the email verification:
${link}

After clicking, wait for the page to load and confirm verification is complete.
Then navigate to the Shopify admin dashboard.
Report the final URL you end up on.
`.trim();

        const verifyResult = await client.run(verifyTask, {
          sessionId,
          timeout: 120_000,
        });

        console.log("   Verification task completed");
        if (verifyResult.output) {
          console.log(`   Output: ${String(verifyResult.output).slice(0, 200)}`);
        }
      } else {
        console.log("   Email received but no verification link found, continuing...");
      }
    } else {
      console.log("   No verification email received, continuing (may not be required)...");
    }

    // ── Task 3: Configure store ──
    console.log("\n   [3/3] Configuring store...");

    const configureTask = `
You are in a Shopify admin dashboard (or just completed signup). Configure the store:

STORE SETTINGS:
1. Go to Settings (bottom left of admin sidebar)
2. Set the store name to "${storeName}" if not already set
3. Make sure the store currency is USD

THEME:
4. Go to Online Store > Themes in the admin
5. Keep the default Dawn theme (fine for dropshipping)

LEGAL PAGES:
6. Go to Settings > Legal (or Settings > Policies)
7. Click "Create from template" for each policy:
   - Privacy Policy
   - Terms of Service
   - Refund Policy
   - Shipping Policy
8. Save each policy

PAYMENTS (if possible on trial):
9. Go to Settings > Payments
10. If Shopify Payments is available, start setup
11. If not, note that payments need manual setup later

FINALLY:
12. Get the store URL (something.myshopify.com) from the browser URL bar or settings
13. Get the admin URL (admin.shopify.com/store/something)
14. Report both URLs in your response

IMPORTANT: The goal is a working store skeleton ready for products.
`.trim();

    const configResult = await client.run(configureTask, {
      sessionId,
      allowedDomains: ["*.shopify.com", "*.myshopify.com"],
      timeout: 300_000,
    });

    console.log("   Configuration task completed");

    // Extract store URLs from task output
    const urls = extractStoreUrl(configResult.output);

    // Also check signup result for URLs
    if (!urls.shopifyUrl) {
      const signupUrls = extractStoreUrl(signupResult.output);
      urls.shopifyUrl = signupUrls.shopifyUrl;
      urls.shopifyAdmin = signupUrls.shopifyAdmin;
    }

    // Extract the domain (e.g. "my-store.myshopify.com") from the URL
    const shopifyDomain = urls.shopifyUrl
      ?.replace("https://", "")
      ?.replace("http://", "");

    // Save final config
    const finalConfig: StoreConfig = {
      storeName,
      niche,
      shopifyUrl: urls.shopifyUrl,
      shopifyAdmin: urls.shopifyAdmin,
      shopifyDomain,
      email,
      password,
      setupComplete: !!urls.shopifyUrl,
      createdAt: new Date().toISOString(),
    };
    saveConfig(finalConfig);

    // Print summary
    console.log("\n   === Store Setup Summary ===");
    console.log(`   Name:     ${finalConfig.storeName}`);
    console.log(`   Niche:    ${finalConfig.niche}`);
    console.log(`   Email:    ${finalConfig.email}`);
    console.log(`   URL:      ${finalConfig.shopifyUrl ?? "not captured"}`);
    console.log(`   Admin:    ${finalConfig.shopifyAdmin ?? "not captured"}`);
    console.log(`   Complete: ${finalConfig.setupComplete}`);
    console.log(`   Config:   ${CONFIG_PATH}\n`);

    if (configResult.output) {
      console.log(`   Final output: ${String(configResult.output).slice(0, 500)}`);
    }
  } catch (e: any) {
    console.error("   Store setup error:", e?.message ?? e);

    // Update partial config with error info
    const existing = loadConfig();
    if (existing) {
      existing.setupComplete = false;
      saveConfig(existing);
    }
    console.log(`   Partial config saved to ${CONFIG_PATH}`);
  } finally {
    // Stop the keepAlive session
    if (sessionId) {
      try {
        await client.sessions.stop(sessionId);
        console.log("   Browser session stopped");
      } catch {
        // best-effort cleanup
      }
    }
  }
}
