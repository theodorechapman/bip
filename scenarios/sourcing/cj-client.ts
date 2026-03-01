/**
 * CJ Dropshipping API client.
 * Free tier: 1000 req/day.
 * Docs: https://developers.cjdropshipping.com/api2.0/v1/
 */

import type {
  SourcedProduct,
  SourcingQuery,
  ShippingAddress,
  CJOrderResult,
  ShippingEstimate,
} from "./types";

const CJ_BASE = "https://developers.cjdropshipping.com/api2.0/v1";

// cached token + expiry
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

function getCJCredentials(): { email: string; password: string } {
  const email = process.env.CJ_EMAIL;
  const password = process.env.CJ_PASSWORD;
  if (!email || !password) {
    throw new Error("CJ_EMAIL and CJ_PASSWORD must be set");
  }
  return { email, password };
}

/**
 * Get access token from CJ API. Tokens last ~15 days, so we cache aggressively.
 */
export async function getCJToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const { email, password } = getCJCredentials();

  const res = await fetch(`${CJ_BASE}/authentication/getAccessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown");
    throw new Error(`cj_auth_failed_${res.status}: ${text}`);
  }

  const data = (await res.json()) as any;
  if (!data.data?.accessToken) {
    throw new Error(`cj_auth_no_token: ${JSON.stringify(data)}`);
  }

  cachedToken = data.data.accessToken;
  // cache for 14 days (1 day buffer before 15 day expiry)
  tokenExpiresAt = Date.now() + 14 * 24 * 60 * 60 * 1000;

  return cachedToken!;
}

/**
 * Internal: make authenticated request to CJ API.
 */
async function cjFetch<T>(
  path: string,
  options?: { method?: string; body?: any; params?: Record<string, string> },
): Promise<T> {
  const token = await getCJToken();
  const method = options?.method ?? "GET";

  let url = `${CJ_BASE}${path}`;
  if (options?.params) {
    const searchParams = new URLSearchParams(options.params);
    url += `?${searchParams.toString()}`;
  }

  const headers: Record<string, string> = {
    "CJ-Access-Token": token,
    "Content-Type": "application/json",
  };

  const res = await fetch(url, {
    method,
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown");
    throw new Error(`cj_api_${res.status}: ${text}`);
  }

  const json = (await res.json()) as any;
  if (json.result === false || json.code !== 200) {
    throw new Error(`cj_api_error: ${json.message ?? JSON.stringify(json)}`);
  }

  return json.data as T;
}

/**
 * Parse CJ product data into our SourcedProduct format.
 */
function parseCJProduct(raw: any): SourcedProduct {
  const variants = (raw.variants ?? []).map((v: any) => ({
    sku: v.vid ?? v.variantSku ?? "",
    name: v.variantName ?? v.variantNameEn ?? "",
    price: parseFloat(v.variantSellPrice ?? v.variantPrice ?? "0"),
    inventory: parseInt(v.variantVolume ?? v.variantStock ?? "0", 10),
  }));

  return {
    supplierId: raw.pid ?? raw.productId ?? "",
    supplierName: "CJ Dropshipping",
    name: raw.productNameEn ?? raw.productName ?? "",
    description: raw.description ?? raw.productDescEn ?? "",
    category: raw.categoryName ?? raw.categoryNameEn ?? "",
    supplierPrice: parseFloat(raw.sellPrice ?? raw.productPrice ?? "0"),
    images: (() => {
      const imgs: string[] = [];
      // productImage is a single URL string, not an array
      if (typeof raw.productImage === "string" && raw.productImage) {
        imgs.push(raw.productImage);
      }
      // productImageSet may contain additional images
      if (Array.isArray(raw.productImageSet)) {
        for (const img of raw.productImageSet) {
          const url = typeof img === "string" ? img : img?.imageUrl ?? "";
          if (url) imgs.push(url);
        }
      }
      return imgs;
    })(),
    variants,
    shippingEstimateDays: parseInt(raw.shippingDays ?? "15", 10),
    sourceUrl: raw.productUrl ?? `https://cjdropshipping.com/product/${raw.pid}`,
  };
}

/**
 * Search for products matching a query.
 */
export async function searchProducts(
  query: SourcingQuery,
): Promise<SourcedProduct[]> {
  const keyword = query.keywords.join(" ");
  const params: Record<string, string> = {
    categoryKeyword: keyword,
    pageNum: "1",
    pageSize: "20",
  };

  if (query.category) {
    params.productType = query.category;
  }

  const data = await cjFetch<any>("/product/list", { params });

  const products: SourcedProduct[] = (data.list ?? data ?? []).map(parseCJProduct);

  // filter by max price
  const filtered = products.filter((p) => {
    if (query.maxPriceUsd && p.supplierPrice > query.maxPriceUsd) return false;
    return true;
  });

  return filtered;
}

/**
 * Get detailed info for a specific product by ID.
 */
export async function getProductDetails(
  productId: string,
): Promise<SourcedProduct> {
  const data = await cjFetch<any>("/product/query", {
    params: { pid: productId },
  });

  return parseCJProduct(data);
}

/**
 * Place an order on CJ Dropshipping.
 */
export async function createCJOrder(input: {
  productId: string;
  variantId: string;
  quantity: number;
  shippingAddress: ShippingAddress;
}): Promise<CJOrderResult> {
  const orderData = {
    products: [
      {
        vid: input.variantId,
        quantity: input.quantity,
      },
    ],
    orderNumber: `BIP-${Date.now()}`,
    shippingCountryCode: input.shippingAddress.country,
    shippingProvince: input.shippingAddress.state,
    shippingCity: input.shippingAddress.city,
    shippingAddress: input.shippingAddress.address1,
    shippingAddress2: input.shippingAddress.address2 ?? "",
    shippingCustomerName: `${input.shippingAddress.firstName} ${input.shippingAddress.lastName}`,
    shippingZip: input.shippingAddress.zip,
    shippingPhone: input.shippingAddress.phone ?? "",
  };

  const data = await cjFetch<any>("/shopping/order/createOrder", {
    method: "POST",
    body: orderData,
  });

  return {
    orderId: data.orderId ?? data.orderNum ?? "",
    status: data.status ?? "created",
  };
}

/**
 * Get shipping estimate for a product to a destination country.
 */
export async function getShippingEstimate(input: {
  productId: string;
  destinationCountry: string;
}): Promise<ShippingEstimate> {
  const data = await cjFetch<any>("/logistic/freight", {
    params: {
      startCountry: "CN",
      endCountry: input.destinationCountry,
      productId: input.productId,
    },
  });

  // data is usually an array of shipping methods, pick the cheapest
  const methods = Array.isArray(data) ? data : [data];
  const cheapest = methods.sort(
    (a: any, b: any) => (a.logisticPrice ?? 999) - (b.logisticPrice ?? 999),
  )[0];

  return {
    shippingDays: parseInt(cheapest?.logisticAging ?? "15", 10),
    shippingCost: parseFloat(cheapest?.logisticPrice ?? "0"),
  };
}

/**
 * Score a product for dropshipping viability.
 * Higher is better. Considers margin potential, shipping time, and image quality.
 */
export function scoreProduct(
  product: SourcedProduct,
  minMarginPct: number = 40,
): number {
  let score = 0;

  // price sweet spot: $5-50 supplier cost (high margin potential)
  if (product.supplierPrice >= 5 && product.supplierPrice <= 50) {
    score += 30;
  } else if (product.supplierPrice > 0 && product.supplierPrice < 5) {
    score += 15;
  } else if (product.supplierPrice > 50) {
    score += 10;
  }

  // shipping time bonus
  if (product.shippingEstimateDays <= 7) {
    score += 30;
  } else if (product.shippingEstimateDays <= 14) {
    score += 20;
  } else if (product.shippingEstimateDays <= 20) {
    score += 10;
  }
  // > 20 days = 0 bonus

  // image quality (more images = better listing potential)
  if (product.images.length >= 5) {
    score += 20;
  } else if (product.images.length >= 3) {
    score += 15;
  } else if (product.images.length >= 1) {
    score += 10;
  }

  // variant availability
  if (product.variants.length > 0) {
    score += 10;
    // bonus for in-stock variants
    const inStock = product.variants.filter((v) => v.inventory > 0).length;
    if (inStock === product.variants.length) {
      score += 10;
    }
  }

  return score;
}

// allow resetting token cache for testing
export function _resetTokenCache(): void {
  cachedToken = null;
  tokenExpiresAt = 0;
}
