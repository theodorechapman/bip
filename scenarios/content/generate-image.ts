/**
 * Gemini-powered image generation for product photos and social content.
 *
 * Uses the Gemini API with imagen-3 for high-quality product images,
 * falling back gracefully so the posting flow can continue text-only.
 */

import type { GenerateImageInput, GenerateImageResult } from "./types";

const GEMINI_MODEL = "gemini-2.0-flash-exp";
const GEMINI_IMAGEN_MODEL = "imagen-3.0-generate-002";

function getGeminiApiKey(): string {
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key) throw new Error("GOOGLE_AI_API_KEY is not set");
  return key;
}

function buildImagePrompt(input: GenerateImageInput): string {
  const { productName, productDescription, style, textOverlay } = input;

  const styleInstructions: Record<typeof style, string> = {
    product_photo: [
      `Professional e-commerce product photo of "${productName}".`,
      `Product: ${productDescription}`,
      "Clean white background, studio lighting, high resolution.",
      "No text overlays. Product centered, slight shadow for depth.",
      "Style: Amazon/Shopify product listing hero image.",
    ].join("\n"),
    lifestyle: [
      `Lifestyle photo featuring "${productName}" in natural use.`,
      `Product: ${productDescription}`,
      "Show the product being used in an aspirational, real-world setting.",
      "Warm natural lighting, shallow depth of field, lifestyle/editorial feel.",
      "No text overlays. Focus on the product in context.",
    ].join("\n"),
    social_post: [
      `Eye-catching social media image for "${productName}".`,
      `Product: ${productDescription}`,
      "Bold, vibrant colors. Modern social media aesthetic.",
      "High contrast, visually striking composition.",
      textOverlay
        ? `Include this text prominently: "${textOverlay}"`
        : "No text overlays.",
      "Optimized for Twitter/X feed (16:9 or square).",
    ].join("\n"),
  };

  return styleInstructions[style];
}

/**
 * Generate a product image using Gemini's native image generation.
 * Uses the multimodal generateContent endpoint with responseModalities including "image".
 */
async function generateWithGemini(
  prompt: string,
  apiKey: string,
): Promise<GenerateImageResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown");
    return { ok: false, error: `gemini_http_${response.status}: ${errorText}` };
  }

  const data = (await response.json()) as any;
  const candidates = data?.candidates;
  if (!candidates || candidates.length === 0) {
    return { ok: false, error: "gemini_no_candidates" };
  }

  // look for inline image data in the response parts
  const parts = candidates[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part?.inlineData?.data && part?.inlineData?.mimeType) {
      return {
        ok: true,
        imageBase64: part.inlineData.data,
        mimeType: part.inlineData.mimeType,
      };
    }
  }

  return { ok: false, error: "gemini_no_image_in_response" };
}

/**
 * Fallback: generate using Imagen 3 dedicated model.
 */
async function generateWithImagen(
  prompt: string,
  apiKey: string,
): Promise<GenerateImageResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGEN_MODEL}:predict?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: "1:1",
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown");
    return { ok: false, error: `imagen_http_${response.status}: ${errorText}` };
  }

  const data = (await response.json()) as any;
  const predictions = data?.predictions;
  if (!predictions || predictions.length === 0) {
    return { ok: false, error: "imagen_no_predictions" };
  }

  const imageBytes = predictions[0]?.bytesBase64Encoded;
  if (!imageBytes) {
    return { ok: false, error: "imagen_no_image_data" };
  }

  return {
    ok: true,
    imageBase64: imageBytes,
    mimeType: predictions[0]?.mimeType ?? "image/png",
  };
}

/**
 * Generate a product image. Tries Gemini native first, falls back to Imagen 3.
 * If both fail, returns { ok: false } — callers should continue without an image.
 */
export async function generateProductImage(
  input: GenerateImageInput,
): Promise<GenerateImageResult> {
  let apiKey: string;
  try {
    apiKey = getGeminiApiKey();
  } catch {
    return { ok: false, error: "GOOGLE_AI_API_KEY not configured" };
  }

  const prompt = buildImagePrompt(input);

  // try gemini native image gen first
  const geminiResult = await generateWithGemini(prompt, apiKey);
  if (geminiResult.ok) return geminiResult;

  console.warn(
    `[generate-image] gemini native failed: ${geminiResult.error}, trying imagen...`,
  );

  // fallback to imagen 3
  const imagenResult = await generateWithImagen(prompt, apiKey);
  if (imagenResult.ok) return imagenResult;

  console.warn(
    `[generate-image] imagen also failed: ${imagenResult.error}`,
  );

  return {
    ok: false,
    error: `all_generators_failed: gemini=${geminiResult.error}, imagen=${imagenResult.error}`,
  };
}
