import { describe, expect, test } from "bun:test";
import { mapNaturalLanguageTask } from "../../src/mapper";

describe("mapNaturalLanguageTask", () => {
  test("maps openrouter task", () => {
    const mapped = mapNaturalLanguageTask("get me an openrouter api key");
    expect(mapped.rail).toBe("x402");
    expect(mapped.normalizedTask).toContain("openrouter");
  });

  test("maps elevenlabs task", () => {
    const mapped = mapNaturalLanguageTask("please buy elevenlabs api key");
    expect(mapped.rail).toBe("x402");
    expect(mapped.normalizedTask).toContain("elevenlabs");
  });

  test("maps gift card task", () => {
    const mapped = mapNaturalLanguageTask("buy a gift card on bitrefill");
    expect(mapped.rail).toBe("bitrefill");
    expect(mapped.tags).toContain("gift-card");
  });
});
