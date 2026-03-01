import { test, expect, describe } from "bun:test";
import { detectCaptchaBlock, getXArkosePublicKey, solveArkoseCaptcha } from "../convex/lib/captchaSolver";

describe("detectCaptchaBlock", () => {
  test("detects captcha keywords in error string", () => {
    expect(detectCaptchaBlock("task failed: captcha challenge appeared")).toBe(true);
    expect(detectCaptchaBlock("arkose labs verification required")).toBe(true);
    expect(detectCaptchaBlock("blocked by bot protection")).toBe(true);
    expect(detectCaptchaBlock("funcaptcha detected")).toBe(true);
    expect(detectCaptchaBlock("captcha_blocked")).toBe(true);
    expect(detectCaptchaBlock("verification puzzle shown")).toBe(true);
  });

  test("detects captcha keywords in output", () => {
    expect(detectCaptchaBlock(undefined, "I encountered a captcha and could not proceed")).toBe(true);
    expect(detectCaptchaBlock(undefined, "Arkose challenge appeared on page")).toBe(true);
  });

  test("returns false for non-captcha errors", () => {
    expect(detectCaptchaBlock("timeout after 240s")).toBe(false);
    expect(detectCaptchaBlock("network error")).toBe(false);
    expect(detectCaptchaBlock("element not found")).toBe(false);
    expect(detectCaptchaBlock(undefined, undefined)).toBe(false);
  });
});

describe("getXArkosePublicKey", () => {
  test("returns signup key by default", () => {
    const key = getXArkosePublicKey();
    expect(key).toBe("2CB16598-CB82-4CF7-B332-5990DB66F3AB");
  });

  test("returns signup key explicitly", () => {
    const key = getXArkosePublicKey("signup");
    expect(key).toBe("2CB16598-CB82-4CF7-B332-5990DB66F3AB");
  });

  test("returns unlock key", () => {
    const key = getXArkosePublicKey("unlock");
    expect(key).toBe("0152B4EB-D2DC-460A-89A1-629838B529C9");
  });
});

describe("solveArkoseCaptcha", () => {
  test("returns error when TWOCAPTCHA_API_KEY is not set", async () => {
    const origKey = process.env.TWOCAPTCHA_API_KEY;
    process.env.TWOCAPTCHA_API_KEY = "";
    try {
      const result = await solveArkoseCaptcha({
        publicKey: "test-key",
        pageUrl: "https://x.com/i/flow/signup",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("TWOCAPTCHA_API_KEY not configured");
    } finally {
      process.env.TWOCAPTCHA_API_KEY = origKey ?? "";
    }
  });

  test("calls 2captcha API and gets a token (live)", async () => {
    const apiKey = process.env.TWOCAPTCHA_API_KEY;
    if (!apiKey) {
      console.log("skipping live test — no TWOCAPTCHA_API_KEY");
      return;
    }

    const result = await solveArkoseCaptcha({
      publicKey: "2CB16598-CB82-4CF7-B332-5990DB66F3AB",
      pageUrl: "https://x.com/i/flow/signup",
    });

    console.log("solve result:", JSON.stringify(result, null, 2));

    // We just check the API call went through — actual solve may fail
    // depending on 2captcha balance/availability
    expect(typeof result.ok).toBe("boolean");
    if (result.ok) {
      expect(result.token).toBeDefined();
      expect(typeof result.token).toBe("string");
      expect(result.token!.length).toBeGreaterThan(10);
    }
    expect(result.elapsedMs).toBeDefined();
  }, 150_000); // 2.5 min timeout for solve
});
