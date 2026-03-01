import { describe, expect, test } from "bun:test";
import { classifyStatusId } from "../../src/commandParsing";

describe("classifyStatusId", () => {
  test("classifies run ids", () => {
    expect(classifyStatusId("run_abc123")).toBe("run");
  });

  test("classifies non-run ids as intent", () => {
    expect(classifyStatusId("pi_abc123")).toBe("intent");
  });
});
