import { describe, test, expect, mock, beforeEach } from "bun:test";

// ── generate-image tests ──

describe("generateProductImage", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.GOOGLE_AI_API_KEY = "test-gemini-key";
  });

  test("returns ok:false when GOOGLE_AI_API_KEY is not set", async () => {
    delete process.env.GOOGLE_AI_API_KEY;
    // re-import to pick up env change
    const { generateProductImage } = await import("../../scenarios/content/generate-image");
    const result = await generateProductImage({
      productName: "Test Widget",
      productDescription: "A cool widget",
      style: "product_photo",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("GOOGLE_AI_API_KEY");
  });

  test("returns image data on successful gemini response", async () => {
    process.env.GOOGLE_AI_API_KEY = "test-gemini-key";

    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      data: "iVBORw0KGgoAAAANS",
                      mimeType: "image/png",
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    ) as any;

    const { generateProductImage } = await import("../../scenarios/content/generate-image");
    const result = await generateProductImage({
      productName: "Test Widget",
      productDescription: "A cool widget",
      style: "lifestyle",
    });

    expect(result.ok).toBe(true);
    expect(result.imageBase64).toBe("iVBORw0KGgoAAAANS");
    expect(result.mimeType).toBe("image/png");

    globalThis.fetch = originalFetch;
  });

  test("falls back to imagen when gemini returns no image", async () => {
    process.env.GOOGLE_AI_API_KEY = "test-gemini-key";

    let callCount = 0;
    globalThis.fetch = mock(async (url: string) => {
      callCount++;
      if (callCount === 1) {
        // gemini returns text only (no image)
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "here is your image description" }] } }],
          }),
          { status: 200 },
        );
      }
      // imagen fallback
      return new Response(
        JSON.stringify({
          predictions: [{ bytesBase64Encoded: "fallbackImageData", mimeType: "image/png" }],
        }),
        { status: 200 },
      );
    }) as any;

    const { generateProductImage } = await import("../../scenarios/content/generate-image");
    const result = await generateProductImage({
      productName: "Fallback Widget",
      productDescription: "Testing fallback",
      style: "social_post",
      textOverlay: "50% OFF",
    });

    expect(result.ok).toBe(true);
    expect(result.imageBase64).toBe("fallbackImageData");
    expect(callCount).toBe(2);

    globalThis.fetch = originalFetch;
  });
});

// ── task-builder tests ──

describe("buildXAccountBootstrapTask", () => {
  test("builds task with profile name and handle", async () => {
    const { buildXAccountBootstrapTask } = await import(
      "../../scenarios/x-account/task-builder"
    );

    const task = buildXAccountBootstrapTask({
      profileName: "Cool Store",
      handle: "coolstore",
      bio: "we sell cool stuff",
      agentCredentialInstructions: "\nEmail: test@agentmail.to\nPassword: abc123",
    });

    expect(task).toContain("[intent=x_account_bootstrap]");
    expect(task).toContain("[provider=x]");
    expect(task).toContain("[domain=x.com]");
    expect(task).toContain("Cool Store");
    expect(task).toContain("@coolstore");
    expect(task).toContain("we sell cool stuff");
    expect(task).toContain("test@agentmail.to");
    expect(task).toContain("https://x.com/i/flow/signup");
  });

  test("handles missing optional fields", async () => {
    const { buildXAccountBootstrapTask } = await import(
      "../../scenarios/x-account/task-builder"
    );

    const task = buildXAccountBootstrapTask({
      profileName: "Minimal Store",
      agentCredentialInstructions: "",
    });

    expect(task).toContain("Minimal Store");
    expect(task).toContain("let X auto-assign");
    expect(task).not.toContain("set bio");
  });
});

describe("buildXPostTask", () => {
  test("builds task with post text", async () => {
    const { buildXPostTask } = await import("../../scenarios/x-account/task-builder");

    const task = buildXPostTask({
      postText: "check out this dope product #shopnow",
      agentCredentialInstructions: "\nEmail: test@agentmail.to\nPassword: abc123",
    });

    expect(task).toContain("[intent=x_post]");
    expect(task).toContain("check out this dope product");
    expect(task).toContain("text-only post");
    expect(task).toContain("https://x.com/home");
  });

  test("includes image note when image provided", async () => {
    const { buildXPostTask } = await import("../../scenarios/x-account/task-builder");

    const task = buildXPostTask({
      postText: "look at this",
      imageBase64: "base64data",
      agentCredentialInstructions: "",
    });

    expect(task).toContain("image has been provided");
    expect(task).not.toContain("text-only post");
  });
});

// ── types sanity check ──

describe("types", () => {
  test("ProductContent type is valid", async () => {
    const types = await import("../../scenarios/content/types");
    // just verify the module loads without errors
    expect(types).toBeDefined();
  });
});

// ── offerings tests ──

describe("offerings", () => {
  test("findPhase1Offering resolves x_account_bootstrap", async () => {
    const { findPhase1Offering } = await import("../../convex/offerings");
    const offering = findPhase1Offering("x_account_bootstrap", "x");
    expect(offering).not.toBeNull();
    expect(offering!.offeringId).toBe("x.account.bootstrap");
    expect(offering!.intentType).toBe("x_account_bootstrap");
  });

  test("findPhase1Offering resolves x_post", async () => {
    const { findPhase1Offering } = await import("../../convex/offerings");
    const offering = findPhase1Offering("x_post", "x");
    expect(offering).not.toBeNull();
    expect(offering!.offeringId).toBe("x.post.create");
    expect(offering!.intentType).toBe("x_post");
  });

  test("findPhase1Offering rejects unknown provider for x_post", async () => {
    const { findPhase1Offering } = await import("../../convex/offerings");
    const offering = findPhase1Offering("x_post", "instagram");
    expect(offering).toBeNull();
  });
});
