/**
 * Shopify Admin API — Product management.
 */

import { shopifyFetch, buildQuery } from "./client";

export type ShopifyVariantInput = {
  price: string;
  sku: string;
  inventory_quantity?: number;
  option1?: string;
  option2?: string;
  option3?: string;
};

export type ShopifyImageInput = {
  src: string;
  alt?: string;
};

export type CreateProductInput = {
  title: string;
  body_html: string;
  vendor: string;
  product_type: string;
  tags: string[];
  variants: ShopifyVariantInput[];
  images: ShopifyImageInput[];
  status?: "active" | "draft" | "archived";
};

export type ShopifyProduct = {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  vendor: string;
  product_type: string;
  tags: string;
  status: string;
  variants: Array<{
    id: number;
    title: string;
    price: string;
    sku: string;
    inventory_quantity: number;
  }>;
  images: Array<{
    id: number;
    src: string;
    alt: string | null;
  }>;
  created_at: string;
  updated_at: string;
};

/**
 * Create a new product on Shopify.
 */
export async function createProduct(
  input: CreateProductInput,
): Promise<{ productId: number; handle: string }> {
  const payload = {
    product: {
      ...input,
      tags: input.tags.join(", "),
    },
  };

  const data = await shopifyFetch<{ product: ShopifyProduct }>(
    "/products.json",
    { method: "POST", body: payload },
  );

  return {
    productId: data.product.id,
    handle: data.product.handle,
  };
}

/**
 * Update an existing product.
 */
export async function updateProduct(
  productId: number,
  updates: Partial<Omit<CreateProductInput, "variants" | "images">>,
): Promise<void> {
  const payload: any = { product: { id: productId, ...updates } };
  if (updates.tags) {
    payload.product.tags = updates.tags.join(", ");
  }

  await shopifyFetch(`/products/${productId}.json`, {
    method: "PUT",
    body: payload,
  });
}

/**
 * List products with optional filters.
 */
export async function listProducts(params?: {
  limit?: number;
  status?: "active" | "draft" | "archived";
  collection_id?: number;
}): Promise<ShopifyProduct[]> {
  const query = buildQuery({
    limit: params?.limit ?? 50,
    status: params?.status,
    collection_id: params?.collection_id,
  });

  const data = await shopifyFetch<{ products: ShopifyProduct[] }>(
    `/products.json${query}`,
  );

  return data.products;
}

/**
 * Get a single product by ID.
 */
export async function getProduct(productId: number): Promise<ShopifyProduct> {
  const data = await shopifyFetch<{ product: ShopifyProduct }>(
    `/products/${productId}.json`,
  );

  return data.product;
}
