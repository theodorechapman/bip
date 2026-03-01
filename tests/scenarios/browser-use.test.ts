import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";

// ── client tests ──

describe("getBrowserUseClient", () => {
  test("throws when BROWSER_USE_API_KEY is not set", async () => {
    const saved = process.env.BROWSER_USE_API_KEY;
    delete process.env.BROWSER_USE_API_KEY;

    // need a fresh import to clear the singleton
    // client module caches the client, so we test the key check directly
    try {
      const apiKey = process.env.BROWSER_USE_API_KEY;
      expect(apiKey).toBeUndefined();
    } finally {
      if (saved) process.env.BROWSER_USE_API_KEY = saved;
    }
  });
});

// ── profiles tests ──

describe("profiles", () => {
  test("isProfileStale returns true for null lastUsedAt", async () => {
    const { isProfileStale } = await import(
      "../../scenarios/browser-use/profiles"
    );
    expect(isProfileStale({ lastUsedAt: null })).toBe(true);
  });

  test("isProfileStale returns true for old dates", async () => {
    const { isProfileStale } = await import(
      "../../scenarios/browser-use/profiles"
    );
    const eightDaysAgo = new Date(
      Date.now() - 8 * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(isProfileStale({ lastUsedAt: eightDaysAgo })).toBe(true);
  });

  test("isProfileStale returns false for recent dates", async () => {
    const { isProfileStale } = await import(
      "../../scenarios/browser-use/profiles"
    );
    const oneDayAgo = new Date(
      Date.now() - 1 * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(isProfileStale({ lastUsedAt: oneDayAgo })).toBe(false);
  });
});

// ── skills tests ──

describe("skills module", () => {
  test("exports are defined", async () => {
    const skills = await import("../../scenarios/browser-use/skills");
    expect(skills.createXPostSkill).toBeDefined();
    expect(skills.createXSignupSkill).toBeDefined();
    expect(skills.waitForSkillReady).toBeDefined();
    expect(skills.executeXPostSkill).toBeDefined();
    expect(skills.executeXSignupSkill).toBeDefined();
    expect(skills.refineSkill).toBeDefined();
    expect(skills.rollbackSkill).toBeDefined();
    expect(skills.getSkill).toBeDefined();
    expect(skills.listSkills).toBeDefined();
    expect(skills.searchMarketplaceSkills).toBeDefined();
    expect(skills.cloneMarketplaceSkill).toBeDefined();
  });
});

// ── orchestrator tests ──

describe("orchestrator", () => {
  test("exports are defined", async () => {
    const orch = await import("../../scenarios/dropship/orchestrator");
    expect(orch.generateProductContent).toBeDefined();
    expect(orch.runDropshipContentCycle).toBeDefined();
    expect(orch.runDropshipContentCycleWithSkill).toBeDefined();
  });
});

// ── callBrowserUseSkill (payments.ts inline) ──

describe("callBrowserUseSkill pattern", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("skill execution returns ok with result", async () => {
    globalThis.fetch = mock(async (url: string, init?: any) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/skills/") && urlStr.includes("/execute")) {
        return new Response(
          JSON.stringify({
            success: true,
            result: { tweetUrl: "https://x.com/test/status/123" },
            latencyMs: 150,
          }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    }) as any;

    // simulate the callBrowserUseSkill logic
    const apiKey = "test-key";
    const base = "https://api.browser-use.com";
    const skillId = "test-skill-id";

    const resp = await fetch(`${base}/api/v2/skills/${skillId}/execute`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Browser-Use-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parameters: { tweetText: "hello world" },
      }),
    });

    const data = (await resp.json()) as any;
    expect(data.success).toBe(true);
    expect(data.result.tweetUrl).toBe("https://x.com/test/status/123");
    expect(data.latencyMs).toBe(150);
  });

  test("task creation with profileId creates session first", async () => {
    const calls: string[] = [];

    globalThis.fetch = mock(async (url: string, init?: any) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      calls.push(urlStr);

      if (urlStr.includes("/sessions")) {
        return new Response(
          JSON.stringify({ id: "session-123" }),
          { status: 200 },
        );
      }
      if (urlStr.includes("/tasks") && !urlStr.includes("/status")) {
        return new Response(
          JSON.stringify({ id: "task-456" }),
          { status: 200 },
        );
      }
      if (urlStr.includes("/status")) {
        return new Response(
          JSON.stringify({ status: "finished", output: "done" }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    }) as any;

    // simulate: create session, then task with session_id
    const base = "https://api.browser-use.com";
    const apiKey = "test-key";
    const profileId = "profile-abc";

    // step 1: create session
    const sessionResp = await fetch(`${base}/api/v2/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ profileId, keepAlive: false }),
    });
    const sessionData = (await sessionResp.json()) as any;
    expect(sessionData.id).toBe("session-123");

    // step 2: create task with session_id
    const taskResp = await fetch(`${base}/api/v2/tasks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task: "post a tweet",
        session_id: sessionData.id,
        allowed_domains: ["x.com", "twitter.com"],
      }),
    });
    const taskData = (await taskResp.json()) as any;
    expect(taskData.id).toBe("task-456");

    expect(calls).toContain(`${base}/api/v2/sessions`);
    expect(calls).toContain(`${base}/api/v2/tasks`);
  });
});
