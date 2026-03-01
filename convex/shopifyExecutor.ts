/**
 * Shopify Executor — execution engine for shopify dropshipping intents.
 *
 * Pure API calls to CJ Dropshipping and Shopify Admin APIs.
 * No browser-use, no email provisioning, no treasury cards needed.
 * Called from executeIntent in executor.ts.
 */

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

// ─── Types ──────────────────────────────────────────────────────────

type ShopifySourceMeta = {
  keywords: string[];
  category?: string;
  maxResults?: number;
  maxPriceUsd?: number;
};

type ShopifyListMeta = {
  marginPct?: number;
  dryRun?: boolean;
};

type ShopifyFulfillMeta = {
  dryRun?: boolean;
};

type ShopifyCycleMeta = {
  keywords?: string[];
  maxProducts?: number;
  marginPct?: number;
  skipSourcing?: boolean;
  skipListing?: boolean;
  skipFulfillment?: boolean;
  dryRun?: boolean;
};

type SourcedProductRecord = {
  cjProductId: string;
  name: string;
  description: string;
  category: string;
  supplierPrice: number;
  retailPrice: number;
  marginPct: number;
  sku: string;
  images: string[];
  variants: Array<{ sku: string; name: string; price: number; inventory: number }>;
  shippingEstimateDays: number;
  sourceUrl: string;
  score: number;
};

type ShopifyExecutorResult = {
  ok: boolean;
  error?: string;
  data?: Record<string, unknown>;
};

// ─── CJ Dropshipping API Client ────────────────────────────────────

const CJ_API_BASE = "https://developers.cjdropshipping.com/api2.0/v1";

let cachedCJToken: { token: string; expiresAt: number } | null = null;

async function getCJToken(): Promise<string> {
  if (cachedCJToken && Date.now() < cachedCJToken.expiresAt) {
    return cachedCJToken.token;
  }

  const email = (process.env.CJ_EMAIL ?? "").trim();
  const password = (process.env.CJ_PASSWORD ?? "").trim();
  if (!email || !password) {
    throw new Error("CJ_EMAIL and CJ_PASSWORD must be configured");
  }

  const res = await fetch(`${CJ_API_BASE}/authentication/getAccessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    throw new Error(`CJ auth failed: HTTP ${res.status}`);
  }

  const json = (await res.json()) as any;
  if (!json?.data?.accessToken) {
    throw new Error(`CJ auth failed: ${json?.message ?? "no token returned"}`);
  }

  const token = json.data.accessToken as string;
  // cache for 14 days (CJ tokens last ~30 days)
  cachedCJToken = { token, expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000 };
  return token;
}

async function cjFetch(
  endpoint: string,
  options: { method?: string; body?: unknown; params?: Record<string, string> } = {},
): Promise<any> {
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const token = await getCJToken();

    let url = `${CJ_API_BASE}${endpoint}`;
    if (options.params) {
      const qs = new URLSearchParams(options.params).toString();
      url += `?${qs}`;
    }

    const fetchOpts: RequestInit = {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        "CJ-Access-Token": token,
      },
    };
    if (options.body) {
      fetchOpts.body = JSON.stringify(options.body);
    }

    const res = await fetch(url, fetchOpts);

    // re-auth on 401
    if (res.status === 401 && attempt < maxRetries - 1) {
      cachedCJToken = null;
      continue;
    }

    // retry on 429
    if (res.status === 429 && attempt < maxRetries - 1) {
      await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));
      continue;
    }

    if (!res.ok) {
      lastError = new Error(`CJ API error: HTTP ${res.status} on ${endpoint}`);
      continue;
    }

    const json = (await res.json()) as any;
    if (json?.result === false) {
      lastError = new Error(`CJ API error: ${json?.message ?? "unknown"}`);
      if (attempt < maxRetries - 1) continue;
    }

    return json;
  }

  throw lastError ?? new Error(`CJ API failed after ${maxRetries} attempts`);
}

// ─── Shopify Admin API Client ───────────────────────────────────────

function getShopifyConfig(): { domain: string; token: string; apiVersion: string } {
  const domain = (process.env.SHOPIFY_SHOP_DOMAIN ?? "").trim();
  const token = (process.env.SHOPIFY_ACCESS_TOKEN ?? "").trim();
  if (!domain || !token) {
    throw new Error("SHOPIFY_SHOP_DOMAIN and SHOPIFY_ACCESS_TOKEN must be configured");
  }
  return { domain, token, apiVersion: "2024-01" };
}

async function shopifyAdminFetch(
  endpoint: string,
  options: { method?: string; body?: unknown; params?: Record<string, string> } = {},
): Promise<any> {
  const config = getShopifyConfig();
  const maxRetries = 4;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let url = `https://${config.domain}/admin/api/${config.apiVersion}${endpoint}`;
    if (options.params) {
      const qs = new URLSearchParams(options.params).toString();
      url += `?${qs}`;
    }

    const fetchOpts: RequestInit = {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": config.token,
      },
    };
    if (options.body) {
      fetchOpts.body = JSON.stringify(options.body);
    }

    const res = await fetch(url, fetchOpts);

    // rate limit backoff
    if (res.status === 429 && attempt < maxRetries - 1) {
      const retryAfter = Number(res.headers.get("Retry-After") ?? (attempt + 1) * 2);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }

    // check rate limit header and slow down if close
    const callLimit = res.headers.get("X-Shopify-Shop-Api-Call-Limit");
    if (callLimit) {
      const [used, max] = callLimit.split("/").map(Number);
      if (used && max && used >= max - 5) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      lastError = new Error(`Shopify API error: HTTP ${res.status} on ${endpoint}: ${body.slice(0, 200)}`);
      if (attempt < maxRetries - 1) continue;
      throw lastError;
    }

    return await res.json();
  }

  throw lastError ?? new Error(`Shopify API failed after ${maxRetries} attempts`);
}

// ─── Product Scoring ────────────────────────────────────────────────

function scoreProduct(
  product: {
    supplierPrice: number;
    shippingEstimateDays: number;
    images: string[];
    variants: Array<{ inventory: number }>;
  },
  _minMarginPct?: number,
): number {
  let score = 0;

  // price sweet spot ($5-$50)
  const price = product.supplierPrice;
  if (price >= 5 && price <= 50) score += 30;
  else if (price > 50 && price <= 100) score += 20;
  else if (price > 0 && price < 5) score += 10;
  else score += 5;

  // shipping speed
  const days = product.shippingEstimateDays;
  if (days <= 7) score += 30;
  else if (days <= 14) score += 20;
  else if (days <= 21) score += 10;
  else score += 0;

  // images
  const imgCount = product.images.length;
  if (imgCount >= 5) score += 20;
  else if (imgCount >= 3) score += 15;
  else if (imgCount >= 1) score += 10;
  else score += 0;

  // variants
  if (product.variants.length > 1) score += 10;

  // in-stock
  const allInStock = product.variants.length > 0 && product.variants.every((v) => v.inventory > 0);
  if (allInStock) score += 10;

  return score;
}

// ─── LLM Copy Generation ───────────────────────────────────────────

async function generateProductCopy(input: {
  productName: string;
  productCategory: string;
  supplierDescription: string;
}): Promise<{ title: string; description: string; tags: string[] }> {
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!apiKey) {
    return { title: input.productName, description: input.supplierDescription, tags: [input.productCategory] };
  }

  const prompt = `You are a Shopify product copywriter. Write a compelling product listing.

Product: ${input.productName}
Category: ${input.productCategory}
Supplier description: ${input.supplierDescription}

Return JSON only: {"title": "...", "description": "<html product description>", "tags": ["tag1", "tag2"]}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      console.warn(`[shopifyExecutor] LLM copy generation failed: HTTP ${res.status}`);
      return { title: input.productName, description: input.supplierDescription, tags: [input.productCategory] };
    }

    const json = (await res.json()) as any;
    const text = json?.content?.[0]?.text ?? "";
    const parsed = JSON.parse(text);
    return {
      title: typeof parsed.title === "string" ? parsed.title : input.productName,
      description: typeof parsed.description === "string" ? parsed.description : input.supplierDescription,
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t: unknown) => typeof t === "string") : [input.productCategory],
    };
  } catch (e: any) {
    console.warn(`[shopifyExecutor] LLM copy failed: ${e?.message}`);
    return { title: input.productName, description: input.supplierDescription, tags: [input.productCategory] };
  }
}

// ─── Convex Mutations/Queries ───────────────────────────────────────

export const upsertShopifyProduct = internalMutation({
  args: {
    userId: v.id("users"),
    cjProductId: v.string(),
    name: v.string(),
    description: v.string(),
    category: v.string(),
    supplierPrice: v.number(),
    retailPrice: v.number(),
    marginPct: v.number(),
    sku: v.string(),
    shopifyProductId: v.union(v.number(), v.null()),
    shopifyHandle: v.union(v.string(), v.null()),
    status: v.string(),
    imagesJson: v.string(),
    variantsJson: v.string(),
    sourceUrl: v.string(),
    shippingEstimateDays: v.number(),
    score: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("shopifyProducts")
      .withIndex("by_user_id_and_cj_product_id", (q) =>
        q.eq("userId", args.userId).eq("cjProductId", args.cjProductId),
      )
      .unique();

    const ts = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        description: args.description,
        category: args.category,
        supplierPrice: args.supplierPrice,
        retailPrice: args.retailPrice,
        marginPct: args.marginPct,
        sku: args.sku,
        shopifyProductId: args.shopifyProductId,
        shopifyHandle: args.shopifyHandle,
        status: args.status,
        imagesJson: args.imagesJson,
        variantsJson: args.variantsJson,
        sourceUrl: args.sourceUrl,
        shippingEstimateDays: args.shippingEstimateDays,
        score: args.score,
        updatedAt: ts,
      });
      return existing._id;
    }

    return await ctx.db.insert("shopifyProducts", {
      ...args,
      createdAt: ts,
      updatedAt: ts,
    });
  },
});

export const getShopifyProductsByStatus = internalQuery({
  args: {
    userId: v.id("users"),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("shopifyProducts")
      .withIndex("by_user_id_and_status", (q) =>
        q.eq("userId", args.userId).eq("status", args.status),
      )
      .collect();
  },
});

export const getShopifyProductByShopifyId = internalQuery({
  args: {
    userId: v.id("users"),
    shopifyProductId: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("shopifyProducts")
      .withIndex("by_user_id_and_shopify_product_id", (q) =>
        q.eq("userId", args.userId).eq("shopifyProductId", args.shopifyProductId),
      )
      .unique();
  },
});

export const updateShopifyProductStatus = internalMutation({
  args: {
    productId: v.id("shopifyProducts"),
    status: v.string(),
    shopifyProductId: v.optional(v.number()),
    shopifyHandle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {
      status: args.status,
      updatedAt: Date.now(),
    };
    if (args.shopifyProductId !== undefined) patch.shopifyProductId = args.shopifyProductId;
    if (args.shopifyHandle !== undefined) patch.shopifyHandle = args.shopifyHandle;
    await ctx.db.patch(args.productId, patch);
  },
});

export const recordShopifyOrder = internalMutation({
  args: {
    userId: v.id("users"),
    shopifyOrderId: v.number(),
    orderName: v.string(),
    totalPrice: v.string(),
    fulfillmentStatus: v.string(),
    lineItemsJson: v.string(),
    shopifyFulfillmentId: v.union(v.number(), v.null()),
    trackingNumber: v.union(v.string(), v.null()),
    trackingCompany: v.union(v.string(), v.null()),
    error: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const ts = Date.now();

    // check if order already recorded
    const existing = await ctx.db
      .query("shopifyOrders")
      .withIndex("by_user_id_and_shopify_order_id", (q) =>
        q.eq("userId", args.userId).eq("shopifyOrderId", args.shopifyOrderId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        fulfillmentStatus: args.fulfillmentStatus,
        lineItemsJson: args.lineItemsJson,
        shopifyFulfillmentId: args.shopifyFulfillmentId,
        trackingNumber: args.trackingNumber,
        trackingCompany: args.trackingCompany,
        error: args.error,
        updatedAt: ts,
      });
      return existing._id;
    }

    return await ctx.db.insert("shopifyOrders", {
      ...args,
      createdAt: ts,
      updatedAt: ts,
    });
  },
});

export const updateShopifyOrderStatus = internalMutation({
  args: {
    orderId: v.id("shopifyOrders"),
    fulfillmentStatus: v.string(),
    shopifyFulfillmentId: v.optional(v.number()),
    trackingNumber: v.optional(v.string()),
    trackingCompany: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {
      fulfillmentStatus: args.fulfillmentStatus,
      updatedAt: Date.now(),
    };
    if (args.shopifyFulfillmentId !== undefined) patch.shopifyFulfillmentId = args.shopifyFulfillmentId;
    if (args.trackingNumber !== undefined) patch.trackingNumber = args.trackingNumber;
    if (args.trackingCompany !== undefined) patch.trackingCompany = args.trackingCompany;
    if (args.error !== undefined) patch.error = args.error;
    await ctx.db.patch(args.orderId, patch);
  },
});

// ─── Execution Functions ────────────────────────────────────────────

async function executeShopifySourceProducts(
  ctx: any,
  userId: Id<"users">,
  meta: ShopifySourceMeta,
): Promise<ShopifyExecutorResult> {
  const keywords = meta.keywords ?? ["trending", "gadget"];
  const maxResults = meta.maxResults ?? 10;
  const maxPriceUsd = meta.maxPriceUsd;

  console.log(`[shopifyExecutor] sourcing products: keywords=${keywords.join(",")}`);

  // search CJ API
  const searchResult = await cjFetch("/product/list", {
    params: {
      productNameEn: keywords.join(" "),
      pageNum: "1",
      pageSize: String(Math.min(maxResults * 3, 50)),
      ...(meta.category ? { categoryId: meta.category } : {}),
    },
  });

  const rawProducts = (searchResult?.data?.list ?? []) as any[];
  console.log(`[shopifyExecutor] CJ returned ${rawProducts.length} products`);

  const products: SourcedProductRecord[] = [];

  for (const raw of rawProducts) {
    const supplierPrice = Number(raw.sellPrice ?? raw.productPrice ?? 0);
    if (supplierPrice <= 0) continue;
    if (maxPriceUsd && supplierPrice > maxPriceUsd) continue;

    const images: string[] = [];
    if (raw.productImage) images.push(raw.productImage);
    if (Array.isArray(raw.productImageSet)) {
      for (const img of raw.productImageSet) {
        if (typeof img === "string") images.push(img);
      }
    }
    if (images.length === 0) continue;

    const variants: Array<{ sku: string; name: string; price: number; inventory: number }> = [];
    if (Array.isArray(raw.variants)) {
      for (const v of raw.variants) {
        variants.push({
          sku: v.vid ?? v.variantSku ?? raw.pid ?? "",
          name: v.variantNameEn ?? v.variantName ?? "",
          price: Number(v.variantSellPrice ?? supplierPrice),
          inventory: Number(v.variantVolume ?? 100),
        });
      }
    }
    if (variants.length === 0) {
      variants.push({
        sku: raw.pid ?? raw.productId ?? "",
        name: "Default",
        price: supplierPrice,
        inventory: 100,
      });
    }

    const shippingDays = Number(raw.shippingTime ?? raw.deliveryDays ?? 15);

    const product: SourcedProductRecord = {
      cjProductId: raw.pid ?? raw.productId ?? "",
      name: raw.productNameEn ?? raw.productName ?? "Unknown Product",
      description: raw.description ?? raw.productNameEn ?? "",
      category: raw.categoryName ?? meta.category ?? "General",
      supplierPrice,
      retailPrice: supplierPrice / (1 - 0.5), // default 50% margin
      marginPct: 50,
      sku: variants[0]?.sku ?? raw.pid ?? "",
      images,
      variants,
      shippingEstimateDays: shippingDays,
      sourceUrl: `https://cjdropshipping.com/product/${raw.pid ?? ""}`,
      score: 0,
    };

    product.score = scoreProduct({
      supplierPrice: product.supplierPrice,
      shippingEstimateDays: product.shippingEstimateDays,
      images: product.images,
      variants: product.variants,
    });

    // filter out low-quality products
    if (product.shippingEstimateDays > 25) continue;

    products.push(product);
  }

  // sort by score descending and take top results
  products.sort((a, b) => b.score - a.score);
  const topProducts = products.slice(0, maxResults);

  // store in convex
  const shopifyExec: any = (internal as any).shopifyExecutor;
  for (const p of topProducts) {
    await ctx.runMutation(shopifyExec.upsertShopifyProduct, {
      userId,
      cjProductId: p.cjProductId,
      name: p.name,
      description: p.description,
      category: p.category,
      supplierPrice: p.supplierPrice,
      retailPrice: p.retailPrice,
      marginPct: p.marginPct,
      sku: p.sku,
      shopifyProductId: null,
      shopifyHandle: null,
      status: "sourced",
      imagesJson: JSON.stringify(p.images),
      variantsJson: JSON.stringify(p.variants),
      sourceUrl: p.sourceUrl,
      shippingEstimateDays: p.shippingEstimateDays,
      score: p.score,
    });
  }

  console.log(`[shopifyExecutor] stored ${topProducts.length} sourced products`);

  return {
    ok: true,
    data: {
      productsSourced: topProducts.length,
      products: topProducts.map((p) => ({
        cjProductId: p.cjProductId,
        name: p.name,
        supplierPrice: p.supplierPrice,
        score: p.score,
        shippingDays: p.shippingEstimateDays,
      })),
    },
  };
}

async function executeShopifyListProducts(
  ctx: any,
  userId: Id<"users">,
  meta: ShopifyListMeta,
): Promise<ShopifyExecutorResult> {
  const marginPct = meta.marginPct ?? 50;
  const dryRun = meta.dryRun ?? false;

  const shopifyExec: any = (internal as any).shopifyExecutor;
  const sourcedProducts = await ctx.runQuery(shopifyExec.getShopifyProductsByStatus, {
    userId,
    status: "sourced",
  });

  if (sourcedProducts.length === 0) {
    return { ok: true, data: { productsListed: 0, message: "no sourced products to list" } };
  }

  console.log(`[shopifyExecutor] listing ${sourcedProducts.length} products (${marginPct}% margin)${dryRun ? " [DRY RUN]" : ""}`);

  let listed = 0;
  const errors: string[] = [];

  for (const product of sourcedProducts) {
    try {
      const retailPrice = product.supplierPrice / (1 - marginPct / 100);
      const variants = JSON.parse(product.variantsJson) as Array<{ sku: string; name: string; price: number; inventory: number }>;
      const images = JSON.parse(product.imagesJson) as string[];

      // generate LLM-enhanced copy
      const copy = await generateProductCopy({
        productName: product.name,
        productCategory: product.category,
        supplierDescription: product.description,
      });

      if (dryRun) {
        console.log(`[shopifyExecutor] [DRY RUN] would create: "${copy.title}" at $${retailPrice.toFixed(2)}`);
        listed++;
        continue;
      }

      // create on Shopify
      const shopifyVariants = variants.length > 0
        ? variants.map((v) => ({
            price: retailPrice.toFixed(2),
            sku: v.sku,
            inventory_quantity: v.inventory,
            ...(v.name && v.name !== "Default" ? { option1: v.name } : {}),
          }))
        : [{ price: retailPrice.toFixed(2), sku: product.sku, inventory_quantity: 100 }];

      const shopifyImages = images.map((src) => ({ src }));

      const createResult = await shopifyAdminFetch("/products.json", {
        method: "POST",
        body: {
          product: {
            title: copy.title,
            body_html: copy.description,
            vendor: "CJ Dropshipping",
            product_type: product.category,
            tags: copy.tags.join(", "),
            variants: shopifyVariants,
            images: shopifyImages,
            status: "active",
          },
        },
      });

      const shopifyProduct = createResult?.product;
      if (!shopifyProduct?.id) {
        errors.push(`Failed to create "${product.name}": no product ID returned`);
        continue;
      }

      // update record in convex
      await ctx.runMutation(shopifyExec.updateShopifyProductStatus, {
        productId: product._id,
        status: "listed",
        shopifyProductId: shopifyProduct.id,
        shopifyHandle: shopifyProduct.handle ?? null,
      });

      listed++;
      console.log(`[shopifyExecutor] created: ${shopifyProduct.handle} (shopify #${shopifyProduct.id})`);
    } catch (e: any) {
      errors.push(`Failed to list "${product.name}": ${e?.message}`);
      console.error(`[shopifyExecutor] list error: ${e?.message}`);
    }
  }

  return {
    ok: true,
    data: {
      productsListed: listed,
      errors: errors.length > 0 ? errors : undefined,
      dryRun,
    },
  };
}

async function executeShopifyFulfillOrders(
  ctx: any,
  userId: Id<"users">,
  meta: ShopifyFulfillMeta,
): Promise<ShopifyExecutorResult> {
  const dryRun = meta.dryRun ?? false;

  console.log(`[shopifyExecutor] checking unfulfilled orders${dryRun ? " [DRY RUN]" : ""}`);

  // get unfulfilled orders from Shopify
  const ordersResult = await shopifyAdminFetch("/orders.json", {
    params: {
      status: "open",
      fulfillment_status: "unfulfilled",
      limit: "50",
    },
  });

  const orders = (ordersResult?.orders ?? []) as any[];
  if (orders.length === 0) {
    return { ok: true, data: { ordersFulfilled: 0, message: "no unfulfilled orders" } };
  }

  console.log(`[shopifyExecutor] found ${orders.length} unfulfilled orders`);

  const shopifyExec: any = (internal as any).shopifyExecutor;
  let fulfilled = 0;
  let errored = 0;
  const results: Array<{ orderId: number; orderName: string; status: string; error?: string }> = [];

  for (const order of orders) {
    try {
      const lineItems = order.line_items ?? [];
      const lineItemResults: Array<{ productId: number; cjOrderId?: string; status: string; error?: string }> = [];

      if (!order.shipping_address) {
        results.push({ orderId: order.id, orderName: order.name, status: "skipped", error: "no_shipping_address" });
        continue;
      }

      if (dryRun) {
        results.push({ orderId: order.id, orderName: order.name, status: "dry_run" });
        fulfilled++;
        continue;
      }

      // process each line item
      for (const item of lineItems) {
        const mapping = await ctx.runQuery(shopifyExec.getShopifyProductByShopifyId, {
          userId,
          shopifyProductId: item.product_id,
        });

        if (!mapping) {
          lineItemResults.push({ productId: item.product_id, status: "skipped", error: "no_mapping" });
          continue;
        }

        try {
          // place order on CJ
          const addr = order.shipping_address;
          const cjOrderResult = await cjFetch("/shopping/order/createOrder", {
            method: "POST",
            body: {
              orderNumber: `SHOPIFY-${order.id}-${item.id}`,
              shippingZip: addr.zip,
              shippingCountry: addr.country_code,
              shippingProvince: addr.province,
              shippingCity: addr.city,
              shippingAddress: addr.address1 + (addr.address2 ? ` ${addr.address2}` : ""),
              shippingCustomerName: `${addr.first_name} ${addr.last_name}`,
              shippingPhone: addr.phone ?? "",
              products: [
                {
                  vid: mapping.sku,
                  quantity: item.quantity,
                },
              ],
            },
          });

          const cjOrderId = cjOrderResult?.data?.orderId ?? cjOrderResult?.data?.orderNum ?? null;
          lineItemResults.push({
            productId: item.product_id,
            cjOrderId: cjOrderId ?? undefined,
            status: cjOrderId ? "cj_placed" : "error",
            error: cjOrderId ? undefined : "no_cj_order_id",
          });
        } catch (e: any) {
          lineItemResults.push({ productId: item.product_id, status: "error", error: e?.message });
        }
      }

      // attempt Shopify fulfillment (modern flow)
      let shopifyFulfillmentId: number | null = null;
      try {
        // get fulfillment orders
        const foResult = await shopifyAdminFetch(`/orders/${order.id}/fulfillment_orders.json`);
        const fulfillmentOrders = (foResult?.fulfillment_orders ?? []) as any[];
        const openFO = fulfillmentOrders.find((fo: any) => fo.status === "open");

        if (openFO) {
          const fulfillResult = await shopifyAdminFetch("/fulfillments.json", {
            method: "POST",
            body: {
              fulfillment: {
                line_items_by_fulfillment_order: [
                  {
                    fulfillment_order_id: openFO.id,
                  },
                ],
                notify_customer: true,
              },
            },
          });
          shopifyFulfillmentId = fulfillResult?.fulfillment?.id ?? null;
        }
      } catch (e: any) {
        console.warn(`[shopifyExecutor] Shopify fulfillment update failed: ${e?.message}`);
      }

      // record in convex
      await ctx.runMutation(shopifyExec.recordShopifyOrder, {
        userId,
        shopifyOrderId: order.id,
        orderName: order.name ?? `#${order.order_number}`,
        totalPrice: order.total_price ?? "0",
        fulfillmentStatus: shopifyFulfillmentId ? "fulfilled" : "cj_placed",
        lineItemsJson: JSON.stringify(lineItemResults),
        shopifyFulfillmentId,
        trackingNumber: null,
        trackingCompany: null,
        error: null,
      });

      fulfilled++;
      results.push({ orderId: order.id, orderName: order.name, status: shopifyFulfillmentId ? "fulfilled" : "cj_placed" });
    } catch (e: any) {
      errored++;
      results.push({ orderId: order.id, orderName: order.name, status: "error", error: e?.message });
      console.error(`[shopifyExecutor] fulfillment error for ${order.name}: ${e?.message}`);
    }
  }

  return {
    ok: true,
    data: {
      ordersFulfilled: fulfilled,
      ordersErrored: errored,
      results,
      dryRun,
    },
  };
}

async function executeShopifyCycle(
  ctx: any,
  userId: Id<"users">,
  meta: ShopifyCycleMeta,
): Promise<ShopifyExecutorResult> {
  const dryRun = meta.dryRun ?? false;
  const results: Record<string, unknown> = { dryRun };

  // stage 1: source
  if (!meta.skipSourcing) {
    const sourceResult = await executeShopifySourceProducts(ctx, userId, {
      keywords: meta.keywords ?? ["trending", "gadget"],
      maxResults: meta.maxProducts ?? 10,
    });
    results.sourcing = sourceResult.data;
    if (!sourceResult.ok) {
      return { ok: false, error: sourceResult.error, data: results };
    }
  }

  // stage 2: list
  if (!meta.skipListing) {
    const listResult = await executeShopifyListProducts(ctx, userId, {
      marginPct: meta.marginPct ?? 50,
      dryRun,
    });
    results.listing = listResult.data;
    if (!listResult.ok) {
      return { ok: false, error: listResult.error, data: results };
    }
  }

  // stage 3: fulfill
  if (!meta.skipFulfillment) {
    const fulfillResult = await executeShopifyFulfillOrders(ctx, userId, { dryRun });
    results.fulfillment = fulfillResult.data;
    if (!fulfillResult.ok) {
      return { ok: false, error: fulfillResult.error, data: results };
    }
  }

  return { ok: true, data: results };
}

// ─── Main Dispatch (called from executor.ts) ───────────────────────

export async function executeShopifyIntent(
  ctx: any,
  intent: { intentType: string | null | undefined; userId: Id<"users">; metadataJson: string | null | undefined },
  meta: any,
  runId: string,
  traceId: string,
): Promise<ShopifyExecutorResult> {
  const userId = intent.userId;
  const intentType = intent.intentType ?? "";

  try {
    switch (intentType) {
      case "shopify_source_products":
        return await executeShopifySourceProducts(ctx, userId, {
          keywords: Array.isArray(meta?.keywords) ? meta.keywords : ["trending"],
          category: typeof meta?.category === "string" ? meta.category : undefined,
          maxResults: typeof meta?.maxResults === "number" ? meta.maxResults : 10,
          maxPriceUsd: typeof meta?.maxPriceUsd === "number" ? meta.maxPriceUsd : undefined,
        });

      case "shopify_list_products":
        return await executeShopifyListProducts(ctx, userId, {
          marginPct: typeof meta?.marginPct === "number" ? meta.marginPct : 50,
          dryRun: meta?.dryRun === true,
        });

      case "shopify_fulfill_orders":
        return await executeShopifyFulfillOrders(ctx, userId, {
          dryRun: meta?.dryRun === true,
        });

      case "shopify_cycle":
        return await executeShopifyCycle(ctx, userId, {
          keywords: Array.isArray(meta?.keywords) ? meta.keywords : undefined,
          maxProducts: typeof meta?.maxProducts === "number" ? meta.maxProducts : undefined,
          marginPct: typeof meta?.marginPct === "number" ? meta.marginPct : undefined,
          skipSourcing: meta?.skipSourcing === true,
          skipListing: meta?.skipListing === true,
          skipFulfillment: meta?.skipFulfillment === true,
          dryRun: meta?.dryRun === true,
        });

      default:
        return { ok: false, error: `unknown shopify intent type: ${intentType}` };
    }
  } catch (e: any) {
    console.error(`[shopifyExecutor] execution failed: ${e?.message}`);
    return { ok: false, error: e?.message ?? "shopify_execution_failed" };
  }
}
