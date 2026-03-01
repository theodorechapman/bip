/**
 * Types for product sourcing from CJ Dropshipping.
 */

export type SourcedProduct = {
  supplierId: string;
  supplierName: string;
  name: string;
  description: string;
  category: string;
  supplierPrice: number;
  images: string[];
  variants: Array<{
    sku: string;
    name: string;
    price: number;
    inventory: number;
  }>;
  shippingEstimateDays: number;
  sourceUrl: string;
};

export type SourcingQuery = {
  keywords: string[];
  category?: string;
  maxPriceUsd?: number;
  minMarginPct?: number;
};

export type SourcingResult = {
  products: SourcedProduct[];
  query: SourcingQuery;
  totalFound: number;
};

export type ShippingAddress = {
  firstName: string;
  lastName: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
};

export type CJOrderInput = {
  productId: string;
  variantId: string;
  quantity: number;
  shippingAddress: ShippingAddress;
};

export type CJOrderResult = {
  orderId: string;
  status: string;
};

export type ShippingEstimate = {
  shippingDays: number;
  shippingCost: number;
};
