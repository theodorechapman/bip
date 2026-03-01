/**
 * Shopify webhook HMAC verification.
 * Uses SHA256 HMAC with timing-safe comparison.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a Shopify webhook's HMAC signature.
 *
 * @param rawBody - The raw request body (must be the exact bytes, not parsed JSON)
 * @param hmacHeader - The X-Shopify-Hmac-Sha256 header value
 * @param secret - The webhook shared secret from Shopify admin
 * @returns true if the signature is valid
 */
export function verifyShopifyWebhook(
  rawBody: Buffer | string,
  hmacHeader: string,
  secret: string,
): boolean {
  if (!hmacHeader || !secret) return false;

  const body = typeof rawBody === "string" ? Buffer.from(rawBody) : rawBody;

  const computed = createHmac("sha256", secret)
    .update(body)
    .digest("base64");

  // timing-safe comparison to prevent timing attacks
  const computedBuf = Buffer.from(computed);
  const headerBuf = Buffer.from(hmacHeader);

  if (computedBuf.length !== headerBuf.length) return false;

  return timingSafeEqual(computedBuf, headerBuf);
}
