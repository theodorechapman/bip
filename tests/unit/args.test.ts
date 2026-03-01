import { describe, expect, test } from "bun:test";
import { normalizeBaseUrl, parseBudgetUsd } from "../../src/args";

describe("parseBudgetUsd", () => {
  test("parses numeric string", () => {
    expect(parseBudgetUsd("8")).toBe(8);
  });

  test("uses fallback when undefined", () => {
    expect(parseBudgetUsd(undefined, 7)).toBe(7);
  });

  test("throws on invalid", () => {
    expect(() => parseBudgetUsd("abc")).toThrow();
    expect(() => parseBudgetUsd("0")).toThrow();
  });
});

describe("normalizeBaseUrl", () => {
  test("trims trailing slash", () => {
    expect(normalizeBaseUrl("https://example.com/")).toBe("https://example.com");
  });

  test("requires protocol", () => {
    expect(() => normalizeBaseUrl("example.com")).toThrow();
  });
});
