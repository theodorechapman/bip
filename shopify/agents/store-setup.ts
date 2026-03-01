/**
 * Store Setup Agent
 * Uses BrowserUse (Cloud when available, local fallback) to create a Shopify store:
 * - Sign up for Shopify free trial
 * - Set store name, niche, basic settings
 * - Pick and customize theme
 * - Set up payment provider
 * - Add legal pages (privacy, terms, refund policy)
 */

import {
  Agent,
  BrowserSession,
  BrowserProfile,
  Controller,
  ActionResult,
  sandbox,
} from "browser-use";
import { CloudBrowserClient } from "browser-use/browser/cloud";
import { ChatAnthropic } from "browser-use/llm/anthropic";
import { ChatOpenAI } from "browser-use/llm/openai";
import { ChatCodex, isCodexAvailable } from "../../src/llm/codex";
import {
  createOrReuseInbox,
  getExistingMessageIds,
  waitForEmail,
  extractVerificationLink,
} from "../../src/agentmail-client";

import { randomBytes } from "node:crypto";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, "..", "config", "store.json");

export type StoreConfig = {
  storeName: string;
  niche: string;
  shopifyUrl?: string;
  shopifyAdmin?: string;
  email?: string;
  password?: string;
  setupComplete: boolean;
  createdAt: string;
};

function getLLM() {
  if (isCodexAvailable()) {
    console.log("   Using Codex (free via ChatGPT subscription)");
    return new ChatCodex({ model: "gpt-5.3-codex" });
  }
  if (process.env.OPENAI_API_KEY) {
    console.log("   Using OpenAI gpt-4o");
    return new ChatOpenAI({
      model: "gpt-4o",
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  if (process.env.ANTHROPIC_API_KEY) {
    console.log("   Using Anthropic Claude");
    return new ChatAnthropic({
      model: "claude-sonnet-4-20250514",
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  throw new Error(
    "Set up Codex auth (~/.codex/auth.json), OPENAI_API_KEY, or ANTHROPIC_API_KEY",
  );
}

function generatePassword(): string {
  return randomBytes(16).toString("base64url") + "!A1";
}

async function createBrowserSession(): Promise<{
  session: BrowserSession;
  cloudClient?: CloudBrowserClient;
}> {
  const apiKey = process.env.BROWSER_USE_API_KEY;

  if (apiKey) {
    // Use Browser Use Cloud — stealth browser with proxies, bypasses Cloudflare
    console.log("   Using Browser Use Cloud (stealth browser)");
    const cloudClient = new CloudBrowserClient({ api_key: apiKey });
    const cloudBrowser = await cloudClient.create_browser({
      cloud_proxy_country_code: "us",
      cloud_timeout: 30,
    });
    console.log(`   Live view: ${cloudBrowser.liveUrl}`);

    const profile = new BrowserProfile({
      highlight_elements: true,
      wait_between_actions: 1.0,
    });
    const session = new BrowserSession({
      cdp_url: cloudBrowser.cdpUrl,
      browser_profile: profile,
    });
    return { session, cloudClient };
  }

  // Local browser fallback
  console.log("   Using local browser (set BROWSER_USE_API_KEY for stealth cloud browser)");
  const profile = new BrowserProfile({
    headless: process.env.BIP_HEADLESS !== "false",
    highlight_elements: true,
    wait_between_actions: 0.5,
    allowed_domains: [
      "*.shopify.com",
      "*.myshopify.com",
      "*.accounts.shopify.com",
    ],
  });
  return { session: new BrowserSession({ browser_profile: profile }) };
}

export async function setupStore(opts: { storeName?: string; niche?: string }) {
  const storeName = opts.storeName ?? `store-${Date.now()}`;
  const niche = opts.niche ?? "general";

  console.log(`\n   Setting up Shopify store: ${storeName}`);
  console.log(`   Niche: ${niche}`);

  // Create agentmail inbox for Shopify signup
  const inbox = await createOrReuseInbox(false);
  const email = inbox.email || inbox.inbox_id;
  const knownIds = await getExistingMessageIds(inbox.inbox_id);
  const password = generatePassword();

  console.log(`   Email: ${email}`);

  // Set up controller with email verification action
  const controller = new Controller();
  controller.registry.action(
    "Check the agent's email inbox for a verification or confirmation email and return the link. Call this when Shopify asks you to verify your email.",
    {},
  )(async function check_verification_email() {
    console.log("   [Action] Checking inbox for verification email...");
    const msg = await waitForEmail(inbox.inbox_id, knownIds, 120, 3);
    if (msg) {
      const link = extractVerificationLink(msg);
      if (link) {
        console.log("   [Action] Found verification link!");
        return new ActionResult({
          extracted_content: `Verification link found: ${link}`,
        });
      }
      const body = msg.text || msg.html || "";
      return new ActionResult({
        extracted_content: `Email received but no obvious verification link found. Email body:\n${body.slice(0, 2000)}`,
      });
    }
    return new ActionResult({
      extracted_content: "No verification email received within timeout.",
    });
  });

  controller.registry.action(
    "Save the Shopify store URL and admin URL after setup is complete. Call this with the store's myshopify.com URL.",
    { store_url: "string", admin_url: "string" },
  )(async function save_store_info(params: {
    store_url: string;
    admin_url: string;
  }) {
    const config: StoreConfig = {
      storeName,
      niche,
      shopifyUrl: params.store_url,
      shopifyAdmin: params.admin_url,
      email,
      setupComplete: true,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log(`   [Action] Store config saved!`);
    return new ActionResult({
      extracted_content: `Store config saved. URL: ${params.store_url}`,
    });
  });

  // Create browser session (cloud if BROWSER_USE_API_KEY set, local otherwise)
  const { session: browserSession, cloudClient } = await createBrowserSession();

  const task = `
You are automating the full process of creating a Shopify dropshipping store from scratch.

STORE DETAILS:
- Store name: "${storeName}"
- Niche: "${niche}"
- Email: use sensitive data 'email'
- Password: use sensitive data 'password'

STEP 1 - SIGN UP FOR SHOPIFY FREE TRIAL:
1. Go to https://www.shopify.com/free-trial
2. Click "Start free trial"
3. CRITICAL INTERACTION INSTRUCTIONS: Shopify's forms may not respond to normal click/input. If clicking or typing into an element fails:
   - Try using keyboard navigation: send_keys(keys="Tab") to move between fields
   - Use send_keys(keys="text here") to type into the focused field
   - Use scroll_down() first to ensure the element is in view
   - Try wait(seconds=3) before interacting
   - As a last resort, try using JavaScript: run_javascript(script="document.querySelector('input[type=email]').value = 'EMAIL_HERE'; document.querySelector('input[type=email]').dispatchEvent(new Event('input', {bubbles: true}))")
4. If asked "What are you looking to do?", select "Start an online store" or similar
5. If asked about selling, pick options related to dropshipping or selling online
6. Answer onboarding questions based on the niche "${niche}"
7. When asked for email, enter the sensitive data 'email'
8. When asked for password, enter the sensitive data 'password'
9. Fill in any required business info (use "United States" as country, any US address is fine)
10. Complete the signup flow

STEP 2 - VERIFY EMAIL (if required):
10. If Shopify asks you to verify your email, use the check_verification_email action
11. Navigate to the verification link in the browser
12. Continue with setup after verification

STEP 3 - BASIC STORE SETTINGS:
13. Once in the Shopify admin dashboard, go to Settings (bottom left)
14. Set the store name to "${storeName}" if not already set
15. Make sure the store currency is USD

STEP 4 - PICK A THEME:
16. Go to Online Store > Themes in the admin
17. The default Dawn theme is fine for dropshipping — keep it
18. If there's an option to customize, set colors that match the "${niche}" niche

STEP 5 - ADD LEGAL PAGES:
19. Go to Settings > Legal (or Settings > Policies)
20. Click "Create from template" for each policy:
    - Privacy Policy
    - Terms of Service
    - Refund Policy
    - Shipping Policy
21. Save each policy

STEP 6 - ENABLE PAYMENTS (if possible on trial):
22. Go to Settings > Payments
23. If Shopify Payments is available, start setup (you can skip full verification for now)
24. If not, note that payments will need manual setup later

STEP 7 - SAVE STORE INFO:
25. Get the store URL (something.myshopify.com) from the browser URL bar or settings
26. Get the admin URL (admin.shopify.com/store/something)
27. Call save_store_info with both URLs

IMPORTANT:
- Be patient with page loads, Shopify can be slow
- If you encounter CAPTCHAs, try to solve them
- Skip optional steps that block progress
- The goal is a working store skeleton ready for products
`;

  const agent = new Agent({
    task,
    llm: getLLM(),
    browser_session: browserSession,
    controller,
    max_actions_per_step: 5,
    max_failures: 10,
    use_vision: true,
    sensitive_data: { email, password },
  });

  try {
    console.log("\n   Starting BrowserUse agent for Shopify store setup...\n");
    const history = await agent.run(80);
    const final = history.final_result();

    // Save config even if agent didn't call save_store_info
    if (!existsSync(CONFIG_PATH) || !JSON.parse(readFileSync(CONFIG_PATH, "utf-8")).setupComplete) {
      const config: StoreConfig = {
        storeName,
        niche,
        email,
        setupComplete: false,
        createdAt: new Date().toISOString(),
      };
      writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    }

    if (final) {
      console.log(`\n   Store setup result: ${final}`);
    }

    // Print summary
    if (existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as StoreConfig;
      console.log("\n   === Store Setup Summary ===");
      console.log(`   Name:     ${saved.storeName}`);
      console.log(`   Niche:    ${saved.niche}`);
      console.log(`   Email:    ${saved.email}`);
      console.log(`   URL:      ${saved.shopifyUrl ?? "not captured"}`);
      console.log(`   Admin:    ${saved.shopifyAdmin ?? "not captured"}`);
      console.log(`   Complete: ${saved.setupComplete}`);
      console.log(`   Config:   ${CONFIG_PATH}\n`);
    }
  } catch (e) {
    console.error("   Store setup error:", e);

    // Save partial config so user can resume
    const config: StoreConfig = {
      storeName,
      niche,
      email,
      password,
      setupComplete: false,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log(`   Partial config saved to ${CONFIG_PATH}`);
  } finally {
    // Clean up cloud browser if used
    if (cloudClient) {
      await cloudClient.stop_browser().catch(() => {});
    }
    await browserSession.close().catch(() => {});
  }
}
