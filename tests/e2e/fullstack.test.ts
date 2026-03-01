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
const ADMIN_CARD_WRITE_TOKEN = "test-admin-card-write-token";
const BROWSER_USE_API_KEY = "test-browser-use-api-key";
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
const mockBrowserUseTasks = new Map<string, { task: string; statusChecks: number }>();

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

  await waitForHttpReady(`${CONVEX_SITE_URL}/auth/login`, 45_000);
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
  mockBrowserUseTasks.clear();
  const fetchHandler = async (request: Request) => {
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

      if (request.method === "POST" && url.pathname === "/api/v2/tasks") {
        const authHeader = request.headers.get("authorization");
        const keyHeader = request.headers.get("x-browser-use-api-key");
        if (
          authHeader !== `Bearer ${BROWSER_USE_API_KEY}` ||
          keyHeader !== BROWSER_USE_API_KEY
        ) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        const body = (await request.json()) as { task?: unknown };
        if (typeof body.task !== "string" || body.task.trim().length === 0) {
          return new Response(JSON.stringify({ error: "task is required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const id = `bu-task-${crypto.randomUUID()}`;
        mockBrowserUseTasks.set(id, { task: body.task, statusChecks: 0 });
        return new Response(JSON.stringify({ id }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (request.method === "GET" && /\/api\/v2\/tasks\/[^/]+\/status$/.test(url.pathname)) {
        const authHeader = request.headers.get("authorization");
        const keyHeader = request.headers.get("x-browser-use-api-key");
        if (
          authHeader !== `Bearer ${BROWSER_USE_API_KEY}` ||
          keyHeader !== BROWSER_USE_API_KEY
        ) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        const taskId = url.pathname.split("/")[4] ?? "";
        const found = mockBrowserUseTasks.get(taskId);
        if (found === undefined) {
          return new Response(JSON.stringify({ error: "Not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }
        found.statusChecks += 1;
        mockBrowserUseTasks.set(taskId, found);
        return new Response(
          JSON.stringify({
            status: "finished",
            output: "Gift card purchase completed successfully",
            taskEcho: found.task,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    };
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidatePort = 3300 + Math.floor(Math.random() * 2000);
    try {
      mockServer = Bun.serve({
        port: candidatePort,
        fetch: fetchHandler,
      });
      break;
    } catch {
      // retry different local port
    }
  }
  if (mockServer === null) {
    throw new Error("Failed to start mock provider server on local ephemeral ports");
  }
  mockBaseUrl = `http://127.0.0.1:${mockServer.port}`;
}

function stopMockProviders(): void {
  if (mockServer !== null) {
    mockServer.stop(true);
    mockServer = null;
  }
  mockAgentmailInboxes.clear();
  mockBrowserUseTasks.clear();
}

async function configureConvexTestEnv(): Promise<void> {
  await runCommandWithRetry(
    ["bunx", "convex", "env", "set", "AUTH_BYPASS", "false"],
    20,
    500,
  );
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
  await runCommandWithRetry(
    ["bunx", "convex", "env", "set", "ADMIN_CARD_WRITE_TOKEN", ADMIN_CARD_WRITE_TOKEN],
    20,
    500,
  );
  await runCommandWithRetry(
    ["bunx", "convex", "env", "set", "BROWSER_USE_API_BASE", mockBaseUrl],
    20,
    500,
  );
  await runCommandWithRetry(
    ["bunx", "convex", "env", "set", "BROWSER_USE_API_KEY", BROWSER_USE_API_KEY],
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
    headers?: Record<string, string>;
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
  if (options?.headers !== undefined) {
    Object.assign(headers, options.headers);
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
  const response = await postJson(
    "/auth/login",
    {
      captchaToken: HCAPTCHA_VALID_TOKEN,
      inviteCode: INVITE_CODE,
    },
    { agentId },
  );
  expect(response.status).toBe(200);
  return response.json as unknown as LoginSuccess;
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
      quickInstall?: unknown;
    };
    expect(manifest.installUrl).toBe(`${CONVEX_SITE_URL}/cli/install.sh`);
    expect(manifest.cliUrl).toBe(`${CONVEX_SITE_URL}/cli/bip.mjs`);
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
    expect(publicCliSource).toContain(
      `const DEFAULT_BASE_URL = "${CONVEX_SITE_URL}";`,
    );
    expect(publicCliSource).toContain("create_agentmail");
    expect(publicCliSource).toContain("delete_agentmail");
  });

  test("rejects login without invite code", async () => {
    const response = await postJson(
      "/auth/login",
      {
        captchaToken: HCAPTCHA_VALID_TOKEN,
      },
      { agentId: `agent-${crypto.randomUUID()}` },
    );
    expect(response.status).toBe(400);
    expect(response.json.error).toBe("captchaToken and inviteCode are required");
  });

  test("rejects login with invalid invite code", async () => {
    const response = await postJson(
      "/auth/login",
      {
        captchaToken: HCAPTCHA_VALID_TOKEN,
        inviteCode: "bad-invite",
      },
      { agentId: `agent-${crypto.randomUUID()}` },
    );
    expect(response.status).toBe(403);
    expect(response.json.error).toBe("Invalid invite code");
  });

  test("rejects login with invalid hcaptcha token", async () => {
    const response = await postJson(
      "/auth/login",
      {
        captchaToken: HCAPTCHA_INVALID_TOKEN,
        inviteCode: INVITE_CODE,
      },
      { agentId: `agent-${crypto.randomUUID()}` },
    );
    expect(response.status).toBe(401);
    expect(response.json.error).toBe("hCaptcha verification failed");
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

  test("returns phase-1 offering registry", async () => {
    const auth = await login(`agent-${crypto.randomUUID()}`);
    const response = await postJson(
      "/api/tools/offering_list",
      {},
      { token: auth.accessToken },
    );
    expect(response.status).toBe(200);
    const offerings = response.json.offerings as Array<Record<string, unknown>>;
    expect(Array.isArray(offerings)).toBe(true);
    expect(offerings.length).toBeGreaterThanOrEqual(3);
    const ids = offerings.map((item) => `${item.offeringId ?? ""}`);
    expect(ids).toContain("giftcard.bitrefill.buy");
    expect(ids).toContain("apikey.provider.buy");
    expect(ids).toContain("account.bootstrap");
  });

  test("supports treasury_card_add/list with masked metadata only", async () => {
    const auth = await login(`agent-${crypto.randomUUID()}`);
    const addResponse = await postJson(
      "/api/tools/treasury_card_add",
      {
        label: "Ops Primary",
        pan: "4111111111111111",
        expMonth: "12",
        expYear: "2030",
        cvv: "123",
        nameOnCard: "Treasury User",
        billingZip: "94107",
      },
      {
        token: auth.accessToken,
        headers: { "x-admin-token": ADMIN_CARD_WRITE_TOKEN },
      },
    );
    expect(addResponse.status).toBe(200);
    expect(addResponse.json.ok).toBe(true);
    expect(`${addResponse.json.cardRef ?? ""}`).toContain("card_ops_primary_");

    const listResponse = await postJson(
      "/api/tools/treasury_card_list",
      {},
      {
        token: auth.accessToken,
        headers: { "x-admin-token": ADMIN_CARD_WRITE_TOKEN },
      },
    );
    expect(listResponse.status).toBe(200);
    const cards = listResponse.json.cards as Array<Record<string, unknown>>;
    expect(Array.isArray(cards)).toBe(true);
    const created = cards.find((card) => card.cardRef === addResponse.json.cardRef);
    expect(created).toBeDefined();
    if (created === undefined) {
      throw new Error("Expected created treasury card metadata");
    }
    expect(created.label).toBe("Ops Primary");
    expect(created.last4).toBe("1111");
    expect(created.exp).toBe("12/2030");
    expect(created.status).toBe("active");
    expect(created.pan).toBeUndefined();
    expect(created.cvv).toBeUndefined();
  });

  test("enforces create_intent offering policy pass/fail", async () => {
    const auth = await login(`agent-${crypto.randomUUID()}`);

    const allowed = await postJson(
      "/api/tools/create_intent",
      {
        task: "buy a gift card and return the code",
        budgetUsd: 10,
        rail: "auto",
        intentType: "giftcard_purchase",
        provider: "bitrefill",
      },
      { token: auth.accessToken },
    );
    expect(allowed.status).toBe(200);
    expect(typeof allowed.json.intentId).toBe("string");

    const disallowedProvider = await postJson(
      "/api/tools/create_intent",
      {
        task: "buy a gift card and return the code",
        budgetUsd: 10,
        rail: "auto",
        intentType: "giftcard_purchase",
        provider: "not-allowed-provider",
      },
      { token: auth.accessToken },
    );
    expect(disallowedProvider.status).toBe(403);
    expect(disallowedProvider.json.code).toBe("offering_not_found");

    const overBudget = await postJson(
      "/api/tools/create_intent",
      {
        task: "buy api key",
        budgetUsd: 100,
        rail: "auto",
        intentType: "api_key_purchase",
        provider: "openrouter",
      },
      { token: auth.accessToken },
    );
    expect(overBudget.status).toBe(403);
    expect(overBudget.json.code).toBe("budget_cap_exceeded_per_intent");
  });

  test("defaults giftcard metadata.cardRef and executes with treasury card artifact", async () => {
    const auth = await login(`agent-${crypto.randomUUID()}`);

    const addCard = await postJson(
      "/api/tools/treasury_card_add",
      {
        label: "Default Treasury",
        pan: "4242424242424242",
        expMonth: "08",
        expYear: "2031",
        cvv: "999",
        nameOnCard: "Default Treasury",
      },
      {
        token: auth.accessToken,
        headers: { "x-admin-token": ADMIN_CARD_WRITE_TOKEN },
      },
    );
    expect(addCard.status).toBe(200);
    const cardRef = `${addCard.json.cardRef ?? ""}`;
    expect(cardRef.length).toBeGreaterThan(0);
    await runCommandWithRetry(
      ["bunx", "convex", "env", "set", "DEFAULT_TREASURY_CARD_REF", cardRef],
      20,
      500,
    );

    const intent = await postJson(
      "/api/tools/create_intent",
      {
        task: "buy a gift card and return the code",
        budgetUsd: 10,
        rail: "auto",
        intentType: "giftcard_purchase",
        provider: "bitrefill",
      },
      { token: auth.accessToken },
    );
    expect(intent.status).toBe(200);
    const intentId = `${intent.json.intentId ?? ""}`;
    expect(intentId.length).toBeGreaterThan(0);

    const status = await postJson(
      "/api/tools/intent_status",
      { intentId },
      { token: auth.accessToken },
    );
    expect(status.status).toBe(200);
    const intentMetadataJson = `${(status.json.intent as Record<string, unknown>).metadataJson ?? ""}`;
    const parsedMetadata = JSON.parse(intentMetadataJson) as Record<string, unknown>;
    expect(parsedMetadata.cardRef).toBe(cardRef);

    const execute = await postJson(
      "/api/tools/execute_intent",
      { intentId },
      { token: auth.accessToken },
    );
    expect(execute.status).toBe(200);
    expect(execute.json.status).toBe("ok");
    expect(execute.json.paymentSource).toBe("treasury_card_ref");
    expect(execute.json.cardRef).toBe(cardRef);

    const runId = `${execute.json.runId ?? ""}`;
    const runStatus = await postJson(
      "/api/tools/run_status",
      { runId },
      { token: auth.accessToken },
    );
    expect(runStatus.status).toBe(200);
    expect(runStatus.json.status).toBe("ok");
    const outputJson = `${runStatus.json.outputJson ?? ""}`;
    expect(outputJson).toContain("treasury_card_ref");
    expect(outputJson).toContain(cardRef);
    expect(outputJson).not.toContain("4242424242424242");
    expect(outputJson).not.toContain("999");
  });

  test("wallet_deposit_address auto-generates wallet and funding_mark_settled credits user funds", async () => {
    const auth = await login(`agent-${crypto.randomUUID()}`);
    const user = await postJson(
      "/api/tools/user_retrieve",
      {},
      { token: auth.accessToken },
    );
    expect(user.status).toBe(200);
    const agentId = `${user.json.agentId ?? ""}`;
    expect(agentId.length).toBeGreaterThan(0);

    const depositAddress = await postJson(
      "/api/tools/wallet_deposit_address",
      {},
      { token: auth.accessToken },
    );
    expect(depositAddress.status).toBe(200);
    expect(`${depositAddress.json.chain ?? ""}`).toBe("solana");
    expect(`${depositAddress.json.address ?? ""}`.length).toBeGreaterThan(20);
    expect(`${depositAddress.json.reference ?? ""}`).toContain("fund_");

    const markSettled = await postJson(
      "/api/tools/funding_mark_settled",
      {
        userIdOrAgentId: agentId,
        amountCents: 1550,
        txSig: "test-solana-signature-123",
        chain: "solana",
      },
      {
        token: auth.accessToken,
        headers: { "x-admin-token": ADMIN_CARD_WRITE_TOKEN },
      },
    );
    expect(markSettled.status).toBe(200);
    expect(markSettled.json.ok).toBe(true);
    expect(markSettled.json.availableCents).toBe(1550);

    const walletBalance = await postJson(
      "/api/tools/wallet_balance",
      { chain: "solana" },
      { token: auth.accessToken },
    );
    expect(walletBalance.status).toBe(200);
    const account = walletBalance.json.account as Record<string, unknown>;
    expect(account.availableCents).toBe(1550);
  });

  test("returns per-agent spend summary totals by provider and intentType", async () => {
    const auth = await login(`agent-${crypto.randomUUID()}`);

    const deposit = await postJson(
      "/api/tools/wallet_deposit",
      { amountCents: 5_000, refType: "test", refId: "seed-funds" },
      { token: auth.accessToken },
    );
    expect(deposit.status).toBe(200);
    expect(deposit.json.ok).toBe(true);

    const firstIntent = await postJson(
      "/api/tools/create_intent",
      {
        task: "giftcard test",
        budgetUsd: 10,
        rail: "auto",
        intentType: "giftcard_purchase",
        provider: "bitrefill",
      },
      { token: auth.accessToken },
    );
    expect(firstIntent.status).toBe(200);

    const secondIntent = await postJson(
      "/api/tools/create_intent",
      {
        task: "api key test",
        budgetUsd: 100,
        rail: "auto",
        intentType: "api_key_purchase",
        provider: "openrouter",
      },
      { token: auth.accessToken },
    );
    expect(secondIntent.status).toBe(403);
    const secondIntentAllowed = await postJson(
      "/api/tools/create_intent",
      {
        task: "api key test",
        budgetUsd: 8,
        rail: "auto",
        intentType: "api_key_purchase",
        provider: "openrouter",
      },
      { token: auth.accessToken },
    );
    expect(secondIntentAllowed.status).toBe(200);

    const summary = await postJson(
      "/api/tools/spend_summary",
      {},
      { token: auth.accessToken },
    );
    expect(summary.status).toBe(200);
    expect(summary.json.totalFunded).toBe(5_000);
    expect(summary.json.totalHeld).toBe(0);
    expect(summary.json.totalSettled).toBe(0);

    const byProvider = summary.json.totalsByProvider as Record<string, any>;
    expect(byProvider.bitrefill.totalBudgetCents).toBe(1_000);
    expect(byProvider.openrouter.totalBudgetCents).toBe(800);

    const byIntentType = summary.json.totalsByIntentType as Record<string, any>;
    expect(byIntentType.giftcard_purchase.totalBudgetCents).toBe(1_000);
    expect(byIntentType.api_key_purchase.totalBudgetCents).toBe(800);
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

    const loginOut = await runCli(
      ["login", "--captcha-token", HCAPTCHA_VALID_TOKEN],
      envOverrides,
    );
    const loginJson = parseCliJson(loginOut.stdout);
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
