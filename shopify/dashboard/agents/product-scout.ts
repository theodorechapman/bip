/**
 * Product Scout Agent
 * BrowserUse agent that scrapes products from a supplier site.
 * Each scout gets its own browser session and reports findings to shared memory.
 */

import {
  Agent,
  BrowserSession,
  BrowserProfile,
  Controller,
  ActionResult,
} from "browser-use";
import { CloudBrowserClient } from "browser-use/browser/cloud";
import { getLLM } from "../llm";
import type { SharedMemory, ProductFinding } from "../memory";

export interface ScoutConfig {
  supplier: string;
  searchTerm: string;
  limit: number;
}

export interface ScoutCallbacks {
  onScreenshot: (base64: string, stepNum: number) => void;
  onLog: (message: string) => void;
  onStatus: (status: string) => void;
  onComplete: (result: string | null) => void;
  shouldStop: () => boolean;
}

const SUPPLIER_URLS: Record<string, string> = {
  aliexpress: "https://www.aliexpress.com",
  amazon: "https://www.amazon.com",
  temu: "https://www.temu.com",
  cj: "https://www.cjdropshipping.com",
};

function buildTaskPrompt(supplier: string, searchTerm: string, limit: number): string {
  const baseUrl = SUPPLIER_URLS[supplier] ?? SUPPLIER_URLS.aliexpress;

  return `You are a product research agent. Your job is to find the best dropshipping products on ${supplier}.

TASK:
1. Navigate to ${baseUrl}
2. Search for "${searchTerm}"
3. Sort results by best-selling / most orders if possible
4. For the top ${limit} products, extract details and report each one using the report_product action
5. For each product, extract: title, price, rating, number of orders, shipping estimate, image URL, and product URL

INSTRUCTIONS:
- Be thorough — scroll through results to find the best products
- If a page takes long to load, wait a few seconds
- If you encounter a CAPTCHA or login wall, try to work around it
- Use check_shared_memory periodically to see what other agents have already found — avoid duplicates
- Report each product as soon as you find it (don't wait until the end)
- Prices should be in USD when possible
- After reporting ${limit} products (or exhausting results), you're done

IMPORTANT:
- Call report_product for EACH product you find
- Include the full product URL so we can link back to it
- If the site blocks you, try a different search variation`;
}

export async function createProductScout(
  config: ScoutConfig,
  memory: SharedMemory,
  callbacks: ScoutCallbacks,
): Promise<{ run: () => Promise<void>; cleanup: () => Promise<void> }> {
  const { supplier, searchTerm, limit } = config;
  const agentId = `scout-${supplier}-${Date.now()}`;

  callbacks.onLog(`Initializing scout for ${supplier}: "${searchTerm}"`);

  // Browser session
  const apiKey = process.env.BROWSER_USE_API_KEY;
  let cloudClient: CloudBrowserClient | undefined;
  let browserSession: BrowserSession;

  if (apiKey) {
    cloudClient = new CloudBrowserClient({ api_key: apiKey });
    const cloudBrowser = await cloudClient.create_browser({
      cloud_proxy_country_code: "us",
      cloud_timeout: 30,
    });
    callbacks.onLog(`Cloud browser live view: ${cloudBrowser.liveUrl}`);
    const profile = new BrowserProfile({
      highlight_elements: true,
      wait_between_actions: 1.0,
    });
    browserSession = new BrowserSession({
      cdp_url: cloudBrowser.cdpUrl,
      browser_profile: profile,
    });
  } else {
    const profile = new BrowserProfile({
      headless: process.env.BIP_HEADLESS !== "false",
      highlight_elements: true,
      wait_between_actions: 0.5,
    });
    browserSession = new BrowserSession({ browser_profile: profile });
  }

  // Controller with custom actions
  const controller = new Controller();

  controller.registry.action(
    "Report a product you found. Call this for each product with its details.",
    {
      title: "string",
      price: "number",
      currency: "string",
      url: "string",
      image_url: "string",
      rating: "number",
      orders: "number",
      shipping_time: "string",
    },
  )(async function report_product(params: {
    title: string;
    price: number;
    currency: string;
    url: string;
    image_url: string;
    rating: number;
    orders: number;
    shipping_time: string;
  }) {
    const normalizedTitle = params.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const product: ProductFinding = {
      title: params.title,
      normalizedTitle,
      supplier,
      price: params.price,
      currency: params.currency || "USD",
      url: params.url,
      imageUrl: params.image_url,
      rating: params.rating,
      orders: params.orders,
      shippingTime: params.shipping_time,
      foundBy: agentId,
      foundAt: new Date().toISOString(),
    };

    memory.addProduct(product);
    callbacks.onLog(`Found: ${params.title} — $${params.price}`);

    return new ActionResult({
      extracted_content: `Product "${params.title}" reported successfully.`,
    });
  });

  controller.registry.action(
    "Check what products other agents have already found in shared memory. Use this to avoid reporting duplicates.",
    {},
  )(async function check_shared_memory() {
    const products = memory.getProducts();
    const summaries: string[] = [];
    for (const [key, findings] of products) {
      const suppliers = findings.map((f) => `${f.supplier}: $${f.price}`).join(", ");
      summaries.push(`- ${key} (${suppliers})`);
    }
    return new ActionResult({
      extracted_content: summaries.length > 0
        ? `Products already found by other agents:\n${summaries.join("\n")}`
        : "No products found by other agents yet.",
    });
  });

  // Build agent
  const task = buildTaskPrompt(supplier, searchTerm, limit);
  let stepCount = 0;

  const agent = new Agent({
    task,
    llm: getLLM(),
    browser_session: browserSession,
    controller,
    max_actions_per_step: 5,
    max_failures: 10,
    use_vision: true,
    register_new_step_callback: async (
      summary: any,
      _output: any,
      step: number,
    ) => {
      stepCount = step;
      if (summary?.screenshot) {
        callbacks.onScreenshot(summary.screenshot, step);
      }
      callbacks.onLog(`Step ${step}`);
    },
    register_done_callback: async (history: any) => {
      callbacks.onLog("Agent completed");
      callbacks.onComplete(history?.final_result?.() ?? null);
    },
    register_should_stop_callback: async () => {
      return callbacks.shouldStop();
    },
  });

  return {
    run: async () => {
      callbacks.onStatus("running");
      try {
        const history = await agent.run(60);
        const result = history.final_result();
        callbacks.onStatus("completed");
        callbacks.onComplete(result);
        memory.addFinding({
          agentId,
          type: "status",
          message: `Scout ${supplier} completed: ${searchTerm}`,
          data: { result },
        });
      } catch (err: any) {
        callbacks.onStatus("error");
        callbacks.onLog(`Error: ${err.message}`);
        memory.addFinding({
          agentId,
          type: "error",
          message: `Scout ${supplier} error: ${err.message}`,
        });
      }
    },
    cleanup: async () => {
      if (cloudClient) {
        await cloudClient.stop_browser().catch(() => {});
      }
      await browserSession.close().catch(() => {});
    },
  };
}
