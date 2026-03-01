import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = process.cwd();
const CONVEX_SITE_URL = "http://127.0.0.1:3211";
const INVITE_CODE = "test-invite-code";
const HCAPTCHA_SECRET = "test-hcaptcha-secret";
const HCAPTCHA_SITE_KEY = "test-hcaptcha-site-key";
const HCAPTCHA_VALID_TOKEN = "test-captcha-pass";
const HCAPTCHA_INVALID_TOKEN = "test-captcha-fail";
const AGENTMAIL_API_KEY = "test-agentmail-api-key";
const AGENTMAIL_DEFAULT_DOMAIN = "agentmail.to";
const AGENTMAIL_MAX_ACTIVE_INBOXES = 3;
const SESSION_API_CALL_LIMIT = 100;
setDefaultTimeout(120_000);

type JsonRecord = Record<string, unknown>;

type AgentmailInbox = {
  clientId: string | null;
  podId: string;
};

type LoginSuccess = {
  accessToken: string;
  expiresAt: number;
  maxApiCalls: number;
  remainingApiCalls: number;
};

type DeleteAgentmailSuccess = {
  ok: boolean;
  inboxId: string;
  deletedLocalRecords: number;
  maxApiCalls: number;
  remainingApiCalls: number;
};

let convexProcess: Bun.Subprocess | null = null;
let mockServer: Bun.Server | null = null;
let mockBaseUrl = "";
const trackedHomes: Array<string> = [];
const mockAgentmailInboxes = new Map<string, AgentmailInbox>();

function commandToString(cmd: Array<string>): string {
  return cmd.map((part) => JSON.stringify(part)).join(" ");
}

function runCommandOrThrow(
  cmd: Array<string>,
  envOverrides?: Record<string, string>,
): { stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd,
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...envOverrides,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = Buffer.from(result.stdout).toString("utf8");
  const stderr = Buffer.from(result.stderr).toString("utf8");
  if (result.exitCode !== 0) {
    throw new Error(
      [
        `Command failed: ${commandToString(cmd)}`,
        `Exit code: ${result.exitCode}`,
        `STDOUT:\n${stdout}`,
        `STDERR:\n${stderr}`,
      ].join("\n"),
    );
  }
  return { stdout, stderr };
}

async function runCommandAsyncOrThrow(
  cmd: Array<string>,
  envOverrides?: Record<string, string>,
): Promise<{ stdout: string; stderr: string }> {
  const childProcess = Bun.spawn({
    cmd,
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...envOverrides,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    childProcess.exited,
    new Response(childProcess.stdout).text(),
    new Response(childProcess.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      [
        `Command failed: ${commandToString(cmd)}`,
        `Exit code: ${exitCode}`,
        `STDOUT:\n${stdout}`,
        `STDERR:\n${stderr}`,
      ].join("\n"),
    );
  }
  return { stdout, stderr };
}

async function runCommandWithRetry(
  cmd: Array<string>,
  retries: number,
  delayMs: number,
): Promise<void> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      runCommandOrThrow(cmd);
      return;
    } catch (error) {
      lastError = error as Error;
      await Bun.sleep(delayMs);
    }
  }
  throw lastError ?? new Error(`Command failed: ${commandToString(cmd)}`);
}

function parseTeamAndProjectFromEnvLocal(): { team: string; project: string } {
  const envLocal = readFileSync(join(REPO_ROOT, ".env.local"), "utf8");
  const match = envLocal.match(/team:\s*([A-Za-z0-9_-]+),\s*project:\s*([A-Za-z0-9_-]+)/);
  if (match === null) {
    throw new Error(
      "Could not parse team/project from .env.local comment. Run Convex setup once before tests.",
    );
  }
  return {
    team: match[1] ?? "",
    project: match[2] ?? "",
  };
}

function resetLocalConvexStorage(): void {
  rmSync(join(REPO_ROOT, ".convex", "local", "default", "convex_local_backend.sqlite3"), {
    force: true,
  });
  rmSync(join(REPO_ROOT, ".convex", "local", "default", "convex_local_storage"), {
    recursive: true,
    force: true,
  });
}

async function waitForHttpReady(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.status > 0) {
        return;
      }
    } catch {
      // still starting
    }
    await Bun.sleep(300);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function startLocalConvexDev(): Promise<void> {
  if (convexProcess !== null) {
    return;
  }
  resetLocalConvexStorage();
  const { team, project } = parseTeamAndProjectFromEnvLocal();
  convexProcess = Bun.spawn({
    cmd: [
      "bunx",
      "convex",
      "dev",
      "--configure",
      "existing",
      "--team",
      team,
      "--project",
      project,
      "--dev-deployment",
      "local",
      "--typecheck",
      "disable",
      "--tail-logs",
      "disable",
    ],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      CONVEX_AGENT_MODE: "anonymous",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  await waitForHttpReady(`${CONVEX_SITE_URL}/cli/manifest.json`, 45_000);
}

function stopLocalConvexDev(): void {
  if (convexProcess === null) {
    return;
  }
  convexProcess.kill();
  convexProcess = null;
}

function parseJsonBody(value: string): JsonRecord {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Expected JSON object");
  }
  return parsed as JsonRecord;
}

function createAgentmailInboxId(username: string, domain: string | null): string {
  return `${username}@${domain ?? AGENTMAIL_DEFAULT_DOMAIN}`;
}

function startMockProviders(): void {
  if (mockServer !== null) {
    return;
  }
  mockAgentmailInboxes.clear();
  mockServer = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);

      if (request.method === "POST" && url.pathname === "/hcaptcha/siteverify") {
        const form = await request.formData();
        const responseToken = `${form.get("response") ?? ""}`;
        if (responseToken === HCAPTCHA_VALID_TOKEN) {
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({
            success: false,
            "error-codes": ["invalid-input-response"],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (url.pathname === "/v0/inboxes") {
        const authHeader = request.headers.get("authorization");
        if (authHeader !== `Bearer ${AGENTMAIL_API_KEY}`) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (request.method === "POST") {
          const body = (await request.json()) as {
            username?: unknown;
            domain?: unknown;
            client_id?: unknown;
          };
          if (typeof body.username !== "string" || body.username.trim().length === 0) {
            return new Response(JSON.stringify({ error: "username is required" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (typeof body.client_id !== "string" || body.client_id.trim().length === 0) {
            return new Response(JSON.stringify({ error: "client_id is required" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (!/^[A-Za-z0-9._~-]+$/.test(body.client_id)) {
            return new Response(
              JSON.stringify({
                name: "ValidationError",
                errors: [
                  {
                    path: ["client_id"],
                    message:
                      "Client ID must contain only the following characters: A-Z a-z 0-9 - . _ ~",
                  },
                ],
              }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
          if (mockAgentmailInboxes.size >= AGENTMAIL_MAX_ACTIVE_INBOXES) {
            return new Response(
              JSON.stringify({
                name: "QuotaExceededError",
                message: `Free tier allows ${AGENTMAIL_MAX_ACTIVE_INBOXES} active inboxes`,
              }),
              {
                status: 429,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
          const domain =
            typeof body.domain === "string" && body.domain.trim().length > 0
              ? body.domain.trim().toLowerCase()
              : null;
          const inboxId = createAgentmailInboxId(body.username.trim(), domain);
          if (mockAgentmailInboxes.has(inboxId)) {
            return new Response(
              JSON.stringify({
                name: "AlreadyExistsError",
                message: "Inbox already exists",
              }),
              {
                status: 409,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
          const podId = `pod-${crypto.randomUUID()}`;
          mockAgentmailInboxes.set(inboxId, {
            clientId: body.client_id,
            podId,
          });
          return new Response(
            JSON.stringify({
              inbox_id: inboxId,
              pod_id: podId,
              client_id: body.client_id,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
      }

      if (request.method === "DELETE" && url.pathname.startsWith("/v0/inboxes/")) {
        const authHeader = request.headers.get("authorization");
        if (authHeader !== `Bearer ${AGENTMAIL_API_KEY}`) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        const inboxId = decodeURIComponent(url.pathname.replace("/v0/inboxes/", ""));
        if (!mockAgentmailInboxes.has(inboxId)) {
          return new Response(JSON.stringify({ error: "Inbox not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }
        mockAgentmailInboxes.delete(inboxId);
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  mockBaseUrl = `http://127.0.0.1:${mockServer.port}`;
}

function stopMockProviders(): void {
  if (mockServer !== null) {
    mockServer.stop(true);
    mockServer = null;
  }
  mockAgentmailInboxes.clear();
}

async function configureConvexTestEnv(): Promise<void> {
  await runCommandWithRetry(
    ["bunx", "convex", "env", "set", "HCAPTCHA_SECRET_KEY", HCAPTCHA_SECRET],
    20,
    500,
  );
  await runCommandWithRetry(
    ["bunx", "convex", "env", "set", "HCAPTCHA_SITE_KEY", HCAPTCHA_SITE_KEY],
    20,
    500,
  );
  await runCommandWithRetry([
    "bunx",
    "convex",
    "env",
    "set",
    "HCAPTCHA_VERIFY_URL",
    `${mockBaseUrl}/hcaptcha/siteverify`,
  ], 20, 500);
  await runCommandWithRetry(
    ["bunx", "convex", "env", "set", "INVITE_CODES", INVITE_CODE],
    20,
    500,
  );
  await runCommandWithRetry(
    ["bunx", "convex", "env", "set", "AGENTMAIL_API_KEY", AGENTMAIL_API_KEY],
    20,
    500,
  );
  await runCommandWithRetry(
    ["bunx", "convex", "env", "set", "AGENTMAIL_BASE_URL", mockBaseUrl],
    20,
    500,
  );
}

async function postJson(
  path: string,
  body: unknown,
  options?: {
    token?: string;
    agentId?: string;
  },
): Promise<{ status: number; json: JsonRecord }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options?.token !== undefined) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options?.agentId !== undefined) {
    headers["X-Agent-Id"] = options.agentId;
  }
  const response = await fetch(`${CONVEX_SITE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const json = text.length > 0 ? parseJsonBody(text) : {};
  return {
    status: response.status,
    json,
  };
}

async function login(agentId: string): Promise<LoginSuccess> {
  const challengeResp = await postJson(
    "/auth/captcha-challenge",
    { inviteCode: INVITE_CODE },
    { agentId },
  );
  expect(challengeResp.status).toBe(200);
  const challengeId = challengeResp.json.challengeId as string;

  const callbackResp = await postJson("/auth/captcha-callback", {
    challengeId,
    captchaToken: HCAPTCHA_VALID_TOKEN,
  });
  expect(callbackResp.status).toBe(200);

  const pollResp = await postJson("/auth/captcha-poll", { challengeId });
  expect(pollResp.status).toBe(200);
  return pollResp.json as unknown as LoginSuccess;
}

async function runCli(
  args: Array<string>,
  envOverrides?: Record<string, string>,
): Promise<{ stdout: string; stderr: string }> {
  const cmd = ["bun", "src/cli.ts", "--json", ...args];
  return await runCommandAsyncOrThrow(cmd, envOverrides);
}

function parseCliJson(output: string): JsonRecord {
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    throw new Error("CLI output was empty");
  }
  return parseJsonBody(trimmed);
}

beforeAll(async () => {
  startMockProviders();
  await startLocalConvexDev();
  await configureConvexTestEnv();
});

afterAll(() => {
  stopMockProviders();
  stopLocalConvexDev();
  for (const home of trackedHomes) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe("Auth + Tool API", () => {
  test("serves public CLI download interface", async () => {
    const manifestResponse = await fetch(`${CONVEX_SITE_URL}/cli/manifest.json`);
    expect(manifestResponse.status).toBe(200);
    const manifest = (await manifestResponse.json()) as {
      installUrl?: unknown;
      cliUrl?: unknown;
      captchaUrl?: unknown;
      quickInstall?: unknown;
    };
    expect(manifest.installUrl).toBe(`${CONVEX_SITE_URL}/cli/install.sh`);
    expect(manifest.cliUrl).toBe(`${CONVEX_SITE_URL}/cli/bip.mjs`);
    expect(manifest.captchaUrl).toBe(`${CONVEX_SITE_URL}/cli/hcaptcha`);
    expect(manifest.quickInstall).toBe(
      `curl -fsSL ${CONVEX_SITE_URL}/cli/install.sh | sh`,
    );

    const installScriptResponse = await fetch(`${CONVEX_SITE_URL}/cli/install.sh`);
    expect(installScriptResponse.status).toBe(200);
    const installScript = await installScriptResponse.text();
    expect(installScript).toContain(`BASE_URL="\${BIP_CLI_BASE_URL:-${CONVEX_SITE_URL}}"`);
    expect(installScript).toContain(`download "$BASE_URL/cli/bip.mjs" "$TARGET"`);

    const publicCliResponse = await fetch(`${CONVEX_SITE_URL}/cli/bip.mjs`);
    expect(publicCliResponse.status).toBe(200);
    const publicCliSource = await publicCliResponse.text();
    expect(publicCliSource).toContain(`const CLI_VERSION = "0.1.0-public";`);
    expect(publicCliSource).toContain(
      `const DEFAULT_BASE_URL = "${CONVEX_SITE_URL}";`,
    );
    expect(publicCliSource).toContain("create_agentmail");
    expect(publicCliSource).toContain("delete_agentmail");
    expect(publicCliSource).toContain("/auth/captcha-challenge");
    expect(publicCliSource).not.toContain("10000000-aaaa-bbbb-cccc-000000000001");

    const captchaPageResponse = await fetch(`${CONVEX_SITE_URL}/cli/hcaptcha`);
    expect(captchaPageResponse.status).toBe(200);
    const captchaPage = await captchaPageResponse.text();
    expect(captchaPage).toContain('id="hcaptcha-container"');
    expect(captchaPage).toContain(`sitekey: "${HCAPTCHA_SITE_KEY}"`);
  });

  test("issues 24h session token and enforces per-session call limit", async () => {
    const auth = await login(`agent-${crypto.randomUUID()}`);
    expect(auth.maxApiCalls).toBe(SESSION_API_CALL_LIMIT);
    expect(auth.remainingApiCalls).toBe(SESSION_API_CALL_LIMIT);

    for (let i = 0; i < SESSION_API_CALL_LIMIT; i += 1) {
      const result = await postJson(
        "/api/tools/user_retrieve",
        {},
        { token: auth.accessToken },
      );
      expect(result.status).toBe(200);
    }

    const overLimit = await postJson(
      "/api/tools/user_retrieve",
      {},
      { token: auth.accessToken },
    );
    expect(overLimit.status).toBe(429);
    expect(overLimit.json.error).toBe("Session API call quota exceeded");
  });

  test("enforces one inbox per agent and still respects global free-tier cap of 3 active inboxes", async () => {
    const createdByAgent: Array<{ auth: LoginSuccess; inboxId: string }> = [];

    for (let i = 0; i < AGENTMAIL_MAX_ACTIVE_INBOXES; i += 1) {
      const auth = await login(`agent-${crypto.randomUUID()}`);
      const email = `quota-${Date.now()}-${i}@agentmail.to`;
      const createResponse = await postJson(
        "/api/tools/create_agentmail",
        { email },
        { token: auth.accessToken },
      );
      expect(createResponse.status).toBe(200);
      expect(createResponse.json.inboxId).toBe(email);
      createdByAgent.push({ auth, inboxId: email });
    }

    const first = createdByAgent[0];
    expect(first).toBeDefined();
    if (first === undefined) {
      throw new Error("Expected first agent to exist");
    }
    const secondInboxForSameAgent = await postJson(
      "/api/tools/create_agentmail",
      { email: `second-${Date.now()}@agentmail.to` },
      { token: first.auth.accessToken },
    );
    expect(secondInboxForSameAgent.status).toBe(400);
    expect(`${secondInboxForSameAgent.json.error ?? ""}`).toContain(
      "Agent already has an active inbox",
    );

    const fourthAgent = await login(`agent-${crypto.randomUUID()}`);
    const overCap = await postJson(
      "/api/tools/create_agentmail",
      { email: `quota-over-${Date.now()}@agentmail.to` },
      { token: fourthAgent.accessToken },
    );
    expect(overCap.status).toBe(400);
    expect(`${overCap.json.error ?? ""}`).toContain(
      "AgentMail create inbox failed (429)",
    );

    const deletedInbox = first?.inboxId ?? "";
    const deleteResponse = await postJson(
      "/api/tools/delete_agentmail",
      { inboxId: deletedInbox },
      { token: first.auth.accessToken },
    );
    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.json.ok).toBe(true);
    expect(deleteResponse.json.inboxId).toBe(deletedInbox);

    const replacementInboxId = `quota-recovered-${Date.now()}@agentmail.to`;
    const createAfterDelete = await postJson(
      "/api/tools/create_agentmail",
      { email: replacementInboxId },
      { token: fourthAgent.accessToken },
    );
    expect(createAfterDelete.status).toBe(200);
    expect(createAfterDelete.json.inboxId).toBe(replacementInboxId);

    for (const entry of createdByAgent.slice(1)) {
      const cleanupDelete = await postJson(
        "/api/tools/delete_agentmail",
        { inboxId: entry.inboxId },
        { token: entry.auth.accessToken },
      );
      expect(cleanupDelete.status).toBe(200);
      expect(cleanupDelete.json.ok).toBe(true);
    }
    const cleanupFourth = await postJson(
      "/api/tools/delete_agentmail",
      { inboxId: replacementInboxId },
      { token: fourthAgent.accessToken },
    );
    expect(cleanupFourth.status).toBe(200);
    expect(cleanupFourth.json.ok).toBe(true);
  });

  test("device flow: create challenge, callback, poll", async () => {
    const agentId = `agent-${crypto.randomUUID()}`;

    // Create challenge
    const challengeResp = await postJson(
      "/auth/captcha-challenge",
      { inviteCode: INVITE_CODE },
      { agentId },
    );
    expect(challengeResp.status).toBe(200);
    expect(typeof challengeResp.json.challengeId).toBe("string");
    expect(typeof challengeResp.json.captchaUrl).toBe("string");
    const challengeId = challengeResp.json.challengeId as string;

    // Poll should return pending
    const pendingResp = await postJson("/auth/captcha-poll", { challengeId });
    expect(pendingResp.status).toBe(202);
    expect(pendingResp.json.status).toBe("pending");

    // Callback with invalid captcha should fail
    const badCallback = await postJson("/auth/captcha-callback", {
      challengeId,
      captchaToken: HCAPTCHA_INVALID_TOKEN,
    });
    expect(badCallback.status).toBe(401);

    // Callback with valid captcha should succeed
    const goodCallback = await postJson("/auth/captcha-callback", {
      challengeId,
      captchaToken: HCAPTCHA_VALID_TOKEN,
    });
    expect(goodCallback.status).toBe(200);
    expect(goodCallback.json.ok).toBe(true);

    // Poll should return completed with access token
    const completedResp = await postJson("/auth/captcha-poll", { challengeId });
    expect(completedResp.status).toBe(200);
    expect(completedResp.json.status).toBe("completed");
    expect(typeof completedResp.json.accessToken).toBe("string");
    expect(typeof completedResp.json.expiresAt).toBe("number");
    expect(completedResp.json.maxApiCalls).toBe(SESSION_API_CALL_LIMIT);

    // Token should work for API calls
    const userResp = await postJson(
      "/api/tools/user_retrieve",
      {},
      { token: completedResp.json.accessToken as string },
    );
    expect(userResp.status).toBe(200);
    expect(userResp.json.agentId).toBe(agentId.toLowerCase());
  });

  test("device flow: rejects challenge with invalid invite code", async () => {
    const resp = await postJson(
      "/auth/captcha-challenge",
      { inviteCode: "bad-code" },
      { agentId: `agent-${crypto.randomUUID()}` },
    );
    expect(resp.status).toBe(403);
  });

  test("device flow: rejects callback for already-completed challenge", async () => {
    const agentId = `agent-${crypto.randomUUID()}`;
    const challengeResp = await postJson(
      "/auth/captcha-challenge",
      { inviteCode: INVITE_CODE },
      { agentId },
    );
    const challengeId = challengeResp.json.challengeId as string;

    await postJson("/auth/captcha-callback", {
      challengeId,
      captchaToken: HCAPTCHA_VALID_TOKEN,
    });

    const secondCallback = await postJson("/auth/captcha-callback", {
      challengeId,
      captchaToken: HCAPTCHA_VALID_TOKEN,
    });
    expect(secondCallback.status).toBe(400);
  });

  test("logout revokes access token", async () => {
    const auth = await login(`agent-${crypto.randomUUID()}`);
    const beforeLogout = await postJson(
      "/api/tools/user_retrieve",
      {},
      { token: auth.accessToken },
    );
    expect(beforeLogout.status).toBe(200);

    const logout = await postJson(
      "/auth/logout",
      {},
      { token: auth.accessToken },
    );
    expect(logout.status).toBe(200);
    expect(logout.json.ok).toBe(true);

    const afterLogout = await postJson(
      "/api/tools/user_retrieve",
      {},
      { token: auth.accessToken },
    );
    expect(afterLogout.status).toBe(401);
    expect(afterLogout.json.error).toBe("Invalid or expired access token");
  });
});

describe("CLI", () => {
  test("runs full invite login + create/delete flow", async () => {
    const tempHome = mkdtempSync(join(tmpdir(), "bip-cli-home-"));
    trackedHomes.push(tempHome);
    const envOverrides = {
      HOME: tempHome,
      BIP_INVITE_CODE: INVITE_CODE,
      CONVEX_SITE_URL,
    };

    const setBaseUrl = await runCli(
      ["config:set-base-url", "--url", CONVEX_SITE_URL],
      envOverrides,
    );
    const setBaseUrlJson = parseCliJson(setBaseUrl.stdout);
    expect(setBaseUrlJson.baseUrl).toBe(CONVEX_SITE_URL);

    const consent = await runCli(["consent", "accept"], envOverrides);
    const consentJson = parseCliJson(consent.stdout);
    expect(typeof consentJson.agentId).toBe("string");

    // Start login in background (it polls for captcha completion)
    const loginProcess = Bun.spawn({
      cmd: ["bun", "src/cli.ts", "--json", "login"],
      cwd: REPO_ROOT,
      env: { ...process.env, ...envOverrides },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for stderr to contain the captcha URL with challenge ID
    const stderrReader = loginProcess.stderr.getReader();
    let stderrText = "";
    const stderrStarted = Date.now();
    while (Date.now() - stderrStarted < 15_000) {
      const { value, done } = await stderrReader.read();
      if (done) break;
      stderrText += new TextDecoder().decode(value);
      if (stderrText.includes("challenge=")) break;
    }
    stderrReader.releaseLock();
    const challengeMatch = stderrText.match(/challenge=([a-f0-9]+)/);
    expect(challengeMatch).not.toBeNull();
    const challengeId = challengeMatch![1];

    // Complete the captcha challenge via API
    const callbackResp = await postJson("/auth/captcha-callback", {
      challengeId,
      captchaToken: HCAPTCHA_VALID_TOKEN,
    });
    expect(callbackResp.status).toBe(200);

    // Wait for CLI to finish
    const [exitCode, stdout] = await Promise.all([
      loginProcess.exited,
      new Response(loginProcess.stdout).text(),
    ]);
    expect(exitCode).toBe(0);
    const loginJson = parseCliJson(stdout);
    expect(loginJson.ok).toBe(true);
    expect(loginJson.maxApiCalls).toBe(SESSION_API_CALL_LIMIT);

    const userRetrieve = await runCli(["user", "retrieve"], envOverrides);
    const userRetrieveJson = parseCliJson(userRetrieve.stdout);
    expect(typeof userRetrieveJson.agentId).toBe("string");
    expect(userRetrieveJson.maxApiCalls).toBe(SESSION_API_CALL_LIMIT);

    const inboxEmail = `cli-${Date.now()}@agentmail.to`;
    const create = await runCli(
      ["create_agentmail", "--email", inboxEmail],
      envOverrides,
    );
    const createJson = parseCliJson(create.stdout);
    expect(createJson.inboxId).toBe(inboxEmail);

    const deleteInbox = await runCli(
      ["delete_agentmail", "--inbox-id", inboxEmail],
      envOverrides,
    );
    const deleteJson = parseCliJson(deleteInbox.stdout) as DeleteAgentmailSuccess;
    expect(deleteJson.ok).toBe(true);
    expect(deleteJson.inboxId).toBe(inboxEmail);
  });
});
