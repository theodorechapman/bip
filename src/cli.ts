#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { mapNaturalLanguageTask } from "./mapper";
import { normalizeBaseUrl, parseBudgetUsd } from "./args";
import { classifyStatusId } from "./commandParsing";

type Config = {
  baseUrl: string;
};

type Session = {
  token: string;
  agentId: string;
  expiresAt: number;
  baseUrl: string;
};

type ApiEnvelope = Record<string, unknown>;

const CLI_VERSION = "0.2.0";
const DEFAULT_BASE_URL = "https://enduring-rooster-593.convex.site";
const CONFIG_DIR = join(homedir(), ".config", "bip");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const SESSION_FILE = join(CONFIG_DIR, "session.json");
const CONSENT_FILE = join(CONFIG_DIR, "consent.json");
const INVITE_CODE_ENV_VAR = "BIP_INVITE_CODE";
const HCAPTCHA_TEST_RESPONSE_TOKEN = "10000000-aaaa-bbbb-cccc-000000000001";

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

function atomicWrite(filePath: string, contents: string): void {
  ensureConfigDir();
  const tmp = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmp, contents, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, filePath);
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function getConfig(): Config {
  const fromFile = readJson<Config>(CONFIG_FILE);
  if (fromFile?.baseUrl) return fromFile;
  const fromEnv = process.env.BIP_BASE_URL ?? process.env.CONVEX_SITE_URL;
  if (fromEnv?.trim()) return { baseUrl: normalizeBaseUrl(fromEnv) };
  return { baseUrl: DEFAULT_BASE_URL };
}

function setConfig(config: Config): void {
  atomicWrite(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function getConsent(): { agentId: string; acceptedAt: string; tosVersion: string } | null {
  return readJson<{ agentId: string; acceptedAt: string; tosVersion: string }>(CONSENT_FILE);
}

function setConsent(agentId?: string): { agentId: string; acceptedAt: string; tosVersion: string } {
  const consent = {
    agentId: agentId ?? getConsent()?.agentId ?? crypto.randomUUID(),
    acceptedAt: new Date().toISOString(),
    tosVersion: "1.2-demo",
  };
  atomicWrite(CONSENT_FILE, JSON.stringify(consent, null, 2));
  return consent;
}

function getOrCreateAgentId(): string {
  const session = readJson<Session>(SESSION_FILE);
  if (session?.agentId) return session.agentId;
  const consent = getConsent();
  if (consent?.agentId) return consent.agentId;
  return crypto.randomUUID();
}

function loadSession(): Session | null {
  const session = readJson<Session>(SESSION_FILE);
  if (!session) return null;
  if (!session.token || !session.agentId || !session.baseUrl || !session.expiresAt) return null;
  return session;
}

function saveSession(session: Session): void {
  atomicWrite(SESSION_FILE, JSON.stringify(session, null, 2));
}

function clearSession(): void {
  if (existsSync(SESSION_FILE)) unlinkSync(SESSION_FILE);
}

function print(data: unknown, asJson = false): void {
  if (asJson || typeof data === "object") {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log(String(data));
}

function printTaskSummary(input: {
  intentId?: unknown;
  runId?: unknown;
  status?: unknown;
  artifacts?: unknown;
  error?: unknown;
}): void {
  if (input.error) {
    console.log(`error: ${String(input.error)}`);
  }
  if (input.intentId) console.log(`intent: ${String(input.intentId)}`);
  if (input.runId) console.log(`run: ${String(input.runId)}`);
  if (input.status) console.log(`status: ${String(input.status)}`);
  if (Array.isArray(input.artifacts) && input.artifacts.length > 0) {
    console.log("artifacts:");
    for (const artifact of input.artifacts) {
      console.log(`- ${JSON.stringify(artifact)}`);
    }
  }
}

function maybePrintFundingHelp(payload: Record<string, unknown>): void {
  const status = String(payload.status ?? payload.error ?? "").toLowerCase();
  if (!status.includes("fund") && status !== "payment_required") return;

  const address =
    (typeof payload.depositAddress === "string" && payload.depositAddress) ||
    (typeof payload.address === "string" && payload.address) ||
    null;
  const estimatedSol =
    (typeof payload.estimatedSol === "number" && payload.estimatedSol) ||
    (typeof payload.estimatedSolNeeded === "number" && payload.estimatedSolNeeded) ||
    null;

  console.log("\nfunding required:");
  if (address) console.log(`deposit address: ${address}`);
  if (estimatedSol !== null) console.log(`estimated SOL needed: ${estimatedSol}`);
}

async function postJson<T>(
  baseUrl: string,
  path: string,
  body: unknown,
  options?: { token?: string; agentId?: string },
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-CLI-Version": CLI_VERSION,
  };
  if (options?.token) headers.Authorization = `Bearer ${options.token}`;
  if (options?.agentId) headers["X-Agent-Id"] = options.agentId;

  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await response.text();
  const data = text.length > 0 ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const message =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof (data as { error?: unknown }).error === "string"
        ? ((data as { error: string }).error)
        : `request failed (${response.status})`;
    throw new ApiError(response.status, message);
  }

  return data as T;
}

async function callTool(path: string, body: unknown): Promise<ApiEnvelope> {
  const session = loadSession();
  if (!session) throw new Error("not logged in. run `bip login` first");
  if (Date.now() >= session.expiresAt) {
    clearSession();
    throw new Error("session expired. run `bip login` again");
  }
  return postJson<ApiEnvelope>(session.baseUrl, path, body, {
    token: session.token,
    agentId: session.agentId,
  });
}

async function taskFlow(taskInput: string, budget: number, asJson: boolean): Promise<void> {
  const mapped = mapNaturalLanguageTask(taskInput);

  const created = await callTool("/api/tools/create_intent", {
    task: mapped.normalizedTask,
    budgetUsd: budget,
    rail: mapped.rail,
    tags: mapped.tags,
  });
  const intentId = String(created.intentId ?? "");
  if (!intentId) throw new Error("intent id missing from create_intent response");

  const currentStatus = String(created.status ?? "").toLowerCase();
  if (currentStatus === "needs_approval") {
    await callTool("/api/tools/approve_intent", { intentId });
  }

  const execution = await callTool("/api/tools/execute_intent", { intentId });
  const runId = execution.runId;

  const statusPayload = runId
    ? await callTool("/api/tools/run_status", { runId })
    : await callTool("/api/tools/intent_status", { intentId });

  if (asJson) {
    print({ mapped, intentId, runId, execution, status: statusPayload }, true);
    return;
  }

  printTaskSummary({
    intentId,
    runId,
    status: statusPayload.status ?? execution.status,
    artifacts: (statusPayload.outputJson as unknown) ?? (execution.output as unknown),
    error: statusPayload.error ?? execution.error,
  });

  maybePrintFundingHelp(execution);
  maybePrintFundingHelp(statusPayload);
}

loadEnvFile(join(process.cwd(), ".env.local"));

export function buildProgram(): Command {
  const program = new Command();

  program.name("bip").description("bip cli").option("--json", "output JSON");

  program
    .command("config:set-base-url")
    .requiredOption("--url <url>", "api base url")
    .action((args: { url: string }) => {
      const next = { baseUrl: normalizeBaseUrl(args.url) };
      setConfig(next);
      print(next, Boolean(program.opts<{ json?: boolean }>().json));
    });

  const consent = program.command("consent").description("manage consent metadata");
  consent.command("accept").action(() => {
    const result = setConsent();
    print(result, Boolean(program.opts<{ json?: boolean }>().json));
  });
  consent.command("check").action(() => {
    const existing = getConsent();
    print(existing ? { accepted: true, ...existing } : { accepted: false }, Boolean(program.opts<{ json?: boolean }>().json));
  });

  program
    .command("login")
    .option("--invite-code <inviteCode>", `invite code or ${INVITE_CODE_ENV_VAR}`)
    .option("--captcha-token <captchaToken>", "hCaptcha response token", HCAPTCHA_TEST_RESPONSE_TOKEN)
    .option("--base-url <baseUrl>", "override API base url")
    .action(async (args: { inviteCode?: string; captchaToken: string; baseUrl?: string }) => {
      const config = getConfig();
      const baseUrl = args.baseUrl ? normalizeBaseUrl(args.baseUrl) : config.baseUrl;
      const inviteCode = args.inviteCode?.trim() ?? process.env[INVITE_CODE_ENV_VAR]?.trim() ?? "";
      if (!inviteCode) {
        throw new Error(`invite code required. pass --invite-code or set ${INVITE_CODE_ENV_VAR}`);
      }
      const agentId = getOrCreateAgentId();
      const result = await postJson<{ accessToken: string; expiresAt: number }>(
        baseUrl,
        "/auth/login",
        { captchaToken: args.captchaToken, inviteCode },
        { agentId },
      );

      saveSession({
        token: result.accessToken,
        agentId,
        expiresAt: result.expiresAt * 1000,
        baseUrl,
      });
      setConfig({ baseUrl });

      const asJson = Boolean(program.opts<{ json?: boolean }>().json);
      if (asJson) {
        print({ ok: true, agentId, expiresAt: new Date(result.expiresAt * 1000).toISOString(), baseUrl }, true);
      } else {
        console.log("logged in");
        console.log(`agent: ${agentId}`);
        console.log(`base: ${baseUrl}`);
      }
    });

  program.command("logout").action(() => {
    clearSession();
    print({ ok: true }, Boolean(program.opts<{ json?: boolean }>().json));
  });

  program.command("wallet").description("show wallet summary").action(async () => {
    const data = await callTool("/api/tools/wallet_balance", { chain: "solana" });
    print(data, Boolean(program.opts<{ json?: boolean }>().json));
  });

  const fund = program.command("fund").description("funding commands");
  fund.command("sync").action(async () => {
    const wallet = await callTool("/api/tools/wallet_balance", { chain: "solana" });
    const asJson = Boolean(program.opts<{ json?: boolean }>().json);
    if (asJson) {
      print(wallet, true);
      return;
    }
    console.log("funding sync complete");
    print(wallet, true);
  });

  program
    .command("task")
    .argument("<prompt>", "natural language task")
    .option("--budget <usd>", "budget in USD", "5")
    .action(async (prompt: string, args: { budget: string }) => {
      await taskFlow(prompt, parseBudgetUsd(args.budget), Boolean(program.opts<{ json?: boolean }>().json));
    });

  program
    .command("status")
    .argument("<id>", "intentId or runId")
    .action(async (id: string) => {
      const looksLikeRun = classifyStatusId(id) === "run";
      const payload = looksLikeRun
        ? await callTool("/api/tools/run_status", { runId: id })
        : await callTool("/api/tools/intent_status", { intentId: id });

      const asJson = Boolean(program.opts<{ json?: boolean }>().json);
      if (asJson) {
        print(payload, true);
        return;
      }
      printTaskSummary({
        intentId: looksLikeRun ? undefined : id,
        runId: looksLikeRun ? id : (payload.intent as Record<string, unknown> | undefined)?.runId,
        status: payload.status ?? (payload.intent as Record<string, unknown> | undefined)?.status,
        artifacts: payload.outputJson,
        error: payload.error,
      });
      maybePrintFundingHelp(payload);
    });

  program
    .command("resume")
    .argument("<intentId>", "intent id")
    .action(async (intentId: string) => {
      const status = await callTool("/api/tools/intent_status", { intentId });
      const intent = status.intent as Record<string, unknown> | undefined;
      const current = String(intent?.status ?? "");

      if (current === "needs_approval") {
        await callTool("/api/tools/approve_intent", { intentId });
      }
      if (["confirmed", "ok"].includes(current)) {
        print({ intentId, status: current, message: "already completed" }, Boolean(program.opts<{ json?: boolean }>().json));
        return;
      }

      const execution = await callTool("/api/tools/execute_intent", { intentId });
      print(execution, Boolean(program.opts<{ json?: boolean }>().json));
      maybePrintFundingHelp(execution);
    });

  // Backward-compatible command aliases
  const user = program.command("user");
  user.command("retrieve").action(async () => {
    const data = await callTool("/api/tools/user_retrieve", {});
    print(data, Boolean(program.opts<{ json?: boolean }>().json));
  });

  program.command("create_agentmail").requiredOption("--email <email>").action(async (args: { email: string }) => {
    const data = await callTool("/api/tools/create_agentmail", { email: args.email });
    print(data, Boolean(program.opts<{ json?: boolean }>().json));
  });

  program.command("delete_agentmail").requiredOption("--inbox-id <inboxId>").action(async (args: { inboxId: string }) => {
    const data = await callTool("/api/tools/delete_agentmail", { inboxId: args.inboxId });
    print(data, Boolean(program.opts<{ json?: boolean }>().json));
  });

  program.command("wallet_register").requiredOption("--chain <chain>").requiredOption("--address <address>").option("--label <label>").action(async (args: { chain: string; address: string; label?: string }) => {
    const data = await callTool("/api/tools/register_wallet", args);
    print(data, Boolean(program.opts<{ json?: boolean }>().json));
  });

  program.command("wallet_balance").option("--chain <chain>", "chain", "solana").action(async (args: { chain: string }) => {
    const data = await callTool("/api/tools/wallet_balance", { chain: args.chain });
    print(data, Boolean(program.opts<{ json?: boolean }>().json));
  });

  program.command("intent_create").requiredOption("--task <task>").option("--budget-usd <budgetUsd>", "budget in usd", "5").option("--rail <rail>", "rail", "auto").action(async (args: { task: string; budgetUsd: string; rail: string }) => {
    const data = await callTool("/api/tools/create_intent", {
      task: args.task,
      budgetUsd: parseBudgetUsd(args.budgetUsd),
      rail: args.rail,
    });
    print(data, Boolean(program.opts<{ json?: boolean }>().json));
  });

  program.command("intent_approve").requiredOption("--intent-id <intentId>").action(async (args: { intentId: string }) => {
    const data = await callTool("/api/tools/approve_intent", { intentId: args.intentId });
    print(data, Boolean(program.opts<{ json?: boolean }>().json));
  });

  program.command("intent_execute").requiredOption("--intent-id <intentId>").action(async (args: { intentId: string }) => {
    const data = await callTool("/api/tools/execute_intent", { intentId: args.intentId });
    print(data, Boolean(program.opts<{ json?: boolean }>().json));
    maybePrintFundingHelp(data);
  });

  program.command("intent_status").requiredOption("--intent-id <intentId>").action(async (args: { intentId: string }) => {
    const data = await callTool("/api/tools/intent_status", { intentId: args.intentId });
    print(data, Boolean(program.opts<{ json?: boolean }>().json));
  });

  program.command("run_status").requiredOption("--run-id <runId>").action(async (args: { runId: string }) => {
    const data = await callTool("/api/tools/run_status", { runId: args.runId });
    print(data, Boolean(program.opts<{ json?: boolean }>().json));
  });

  return program;
}

if (import.meta.main) {
  buildProgram()
    .parseAsync(process.argv)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(message);
      process.exit(1);
    });
}
