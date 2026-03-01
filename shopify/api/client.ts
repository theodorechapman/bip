/**
 * Shopify Admin REST API base client.
 * Rate-limited fetch with exponential backoff on 429s.
 */

const API_VERSION = "2025-01";

function getShopifyConfig(): { domain: string; token: string } {
  const domain = process.env.SHOPIFY_SHOP_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!domain || !token) {
    throw new Error("SHOPIFY_SHOP_DOMAIN and SHOPIFY_ACCESS_TOKEN must be set");
  }
  return { domain, token };
}

/**
 * Rate-limited fetch wrapper for Shopify Admin API.
 * Respects X-Shopify-Shop-Api-Call-Limit header (backs off at 35/40).
 * Retries 429s with exponential backoff (max 3 retries).
 */
export async function shopifyFetch<T>(
  endpoint: string,
  options?: { method?: string; body?: any },
): Promise<T> {
  const { domain, token } = getShopifyConfig();
  const method = options?.method ?? "GET";
  const url = `https://${domain}/admin/api/${API_VERSION}${endpoint}`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      // exponential backoff: 1s, 2s, 4s
      const delay = Math.pow(2, attempt - 1) * 1000;
      await new Promise((r) => setTimeout(r, delay));
    }

    const headers: Record<string, string> = {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    };

    const res = await fetch(url, {
      method,
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    // check rate limit header before processing
    const callLimit = res.headers.get("X-Shopify-Shop-Api-Call-Limit");
    if (callLimit) {
      const [used, max] = callLimit.split("/").map(Number);
      if (used >= max - 5) {
        // approaching limit, pause briefly
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After");
      if (retryAfter) {
        await new Promise((r) =>
          setTimeout(r, parseFloat(retryAfter) * 1000),
        );
      }
      lastError = new Error(`shopify_rate_limited (attempt ${attempt + 1})`);
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "unknown");
      throw new Error(`shopify_api_${res.status}: ${text}`);
    }

    // some endpoints return 204 No Content
    if (res.status === 204) {
      return {} as T;
    }

    return (await res.json()) as T;
  }

  throw lastError ?? new Error("shopify_fetch_exhausted_retries");
}

/**
 * Helper to build query string from params.
 */
export function buildQuery(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== "",
  );
  if (entries.length === 0) return "";
  const sp = new URLSearchParams(
    entries.map(([k, v]) => [k, String(v)]),
  );
  return `?${sp.toString()}`;
}
