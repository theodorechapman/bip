#!/usr/bin/env bun

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";

type Config = {
  baseUrl: string;
};

type Consent = {
  tosVersion: string;
  acceptedAt: string;
  agentId: string;
};

type Credentials = {
  accessToken: string;
  expiresAt: number;
  baseUrl: string;
};

type EncryptedEnvelope = {
  encryption: {
    cipher: "aes-256-gcm";
    kdf: "scrypt";
    kdfparams: {
      n: number;
      r: number;
      p: number;
    };
    salt: string;
    iv: string;
    tag: string;
  };
  data: string;
};

type LoginResponse = {
  accessToken: string;
  expiresAt: number;
  maxApiCalls: number;
  remainingApiCalls: number;
  agentId?: string;
};

type UserRetrieveResponse = {
  id: string;
  email: string | null;
  agentId: string;
  maxApiCalls: number;
  remainingApiCalls: number;
};

type CreateAgentmailResponse = {
  inboxId: string;
  email: string;
  podId: string;
  clientId: string | null;
  maxApiCalls: number;
  remainingApiCalls: number;
};

type DeleteAgentmailResponse = {
  ok: boolean;
  inboxId: string;
  deletedLocalRecords: number;
  maxApiCalls: number;
  remainingApiCalls: number;
};

type GenericOk = Record<string, unknown>;

const CLI_VERSION = "0.1.0";
const CONFIG_DIR = join(homedir(), ".config", "bip");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const CONSENT_FILE = join(CONFIG_DIR, "consent.json");
const CREDENTIALS_FILE = join(CONFIG_DIR, "credentials.json");
const ENCRYPTION_KEY_FILE = join(CONFIG_DIR, ".encryption-key");
const AGENT_ID_FILE = join(CONFIG_DIR, "agent-id");

const SCRYPT_N = 2 ** 18;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LEN = 32;
const SCRYPT_MAX_MEM = 512 * 1024 * 1024;
const HCAPTCHA_TEST_RESPONSE_TOKEN = "10000000-aaaa-bbbb-cccc-000000000001";
const INVITE_CODE_ENV_VAR = "BIP_INVITE_CODE";

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function loadEnvFile(filepath: string): void {
  if (!existsSync(filepath)) {
    return;
  }
  const source = readFileSync(filepath, "utf-8");
  const lines = source.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

function atomicWrite(filePath: string, contents: string, mode: number): void {
  ensureConfigDir();
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmpPath, contents, { encoding: "utf-8", mode });
  renameSync(tmpPath, filePath);
}

function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const value = JSON.parse(readFileSync(filePath, "utf-8")) as T;
    return value;
  } catch {
    return null;
  }
}

function getAgentId(): string | null {
  const fromEnv = process.env.BIP_AGENT_ID?.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  if (existsSync(AGENT_ID_FILE)) {
    try {
      const id = readFileSync(AGENT_ID_FILE, "utf-8").trim();
      if (id.length > 0) return id;
    } catch {
      /* ignore */
    }
  }
  const consent = getConsent();
  return consent?.agentId ?? null;
}

function persistAgentId(agentId: string): void {
  ensureConfigDir();
  atomicWrite(AGENT_ID_FILE, agentId.trim(), 0o600);
}

function getConfig(): Config {
  const fromFile = readJsonFile<Config>(CONFIG_FILE);
  if (fromFile !== null && fromFile.baseUrl.length > 0) {
    return fromFile;
  }
  const envBaseUrl = process.env.CONVEX_SITE_URL;
  if (typeof envBaseUrl === "string" && envBaseUrl.length > 0) {
    return { baseUrl: envBaseUrl };
  }
  return { baseUrl: "http://127.0.0.1:3211" };
}

function setConfig(config: Config): void {
  atomicWrite(CONFIG_FILE, JSON.stringify(config, null, 2), 0o600);
}

function getConsent(): Consent | null {
  return readJsonFile<Consent>(CONSENT_FILE);
}

function setConsent(consent: Consent): void {
  atomicWrite(CONSENT_FILE, JSON.stringify(consent, null, 2), 0o600);
}

function getEncryptionKey(): string {
  const envKey = process.env.MOONPAY_DEMO_ENCRYPTION_KEY;
  if (typeof envKey === "string" && envKey.length > 0) {
    return envKey;
  }
  if (existsSync(ENCRYPTION_KEY_FILE)) {
    return readFileSync(ENCRYPTION_KEY_FILE, "utf-8").trim();
  }
  const randomKey = randomBytes(32).toString("hex");
  atomicWrite(ENCRYPTION_KEY_FILE, randomKey, 0o600);
  return randomKey;
}

function encryptPayload(payload: string, encryptionKey: string): EncryptedEnvelope {
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const derivedKey = scryptSync(encryptionKey, salt, SCRYPT_KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAX_MEM,
  });
  const cipher = createCipheriv("aes-256-gcm", derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  return {
    encryption: {
      cipher: "aes-256-gcm",
      kdf: "scrypt",
      kdfparams: {
        n: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
      },
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    },
    data: encrypted.toString("base64"),
  };
}

function decryptPayload(envelope: EncryptedEnvelope, encryptionKey: string): string {
  const salt = Buffer.from(envelope.encryption.salt, "base64");
  const iv = Buffer.from(envelope.encryption.iv, "base64");
  const tag = Buffer.from(envelope.encryption.tag, "base64");
  const derivedKey = scryptSync(encryptionKey, salt, SCRYPT_KEY_LEN, {
    N: envelope.encryption.kdfparams.n,
    r: envelope.encryption.kdfparams.r,
    p: envelope.encryption.kdfparams.p,
    maxmem: SCRYPT_MAX_MEM,
  });
  const decipher = createDecipheriv("aes-256-gcm", derivedKey, iv, {
    authTagLength: 16,
  });
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function saveCredentials(credentials: Credentials): void {
  const key = getEncryptionKey();
  const encrypted = encryptPayload(JSON.stringify(credentials), key);
  atomicWrite(CREDENTIALS_FILE, JSON.stringify(encrypted, null, 2), 0o600);
}

function loadCredentials(): Credentials | null {
  if (!existsSync(CREDENTIALS_FILE)) {
    return null;
  }
  try {
    const key = getEncryptionKey();
    const encrypted = readJsonFile<EncryptedEnvelope>(CREDENTIALS_FILE);
    if (encrypted === null) {
      return null;
    }
    const raw = decryptPayload(encrypted, key);
    const parsed = JSON.parse(raw) as Credentials;
    if (
      typeof parsed.accessToken !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      typeof parsed.baseUrl !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearCredentials(): void {
  if (existsSync(CREDENTIALS_FILE)) {
    unlinkSync(CREDENTIALS_FILE);
  }
}

function commonHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-CLI-Version": CLI_VERSION,
  };
  const agentId = getAgentId();
  headers["X-Agent-Id"] = agentId ?? "bootstrap";
  return headers;
}

async function postJson<T>(
  baseUrl: string,
  path: string,
  body: unknown,
  token: string | null,
): Promise<T> {
  const headers = commonHeaders();
  if (token !== null) {
    headers.Authorization = `Bearer ${token}`;
  }
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
      typeof data.error === "string"
        ? data.error
        : `Request failed (${response.status})`;
    throw new ApiError(response.status, message);
  }
  return data as T;
}

export async function callProtectedTool<T>(path: string, body: unknown): Promise<T> {
  const credentials = loadCredentials();
  if (credentials === null) {
    throw new Error("Not logged in. Run `bun run cli -- login` first.");
  }
  if (Date.now() >= credentials.expiresAt) {
    clearCredentials();
    throw new Error("Session expired. Run `bun run cli -- login` again.");
  }
  return await postJson<T>(
    credentials.baseUrl,
    path,
    body,
    credentials.accessToken,
  );
}

function print(value: unknown, asJson: boolean): void {
  if (asJson || typeof value === "object") {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(value);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

function requireConsent(): Consent {
  const consent = getConsent();
  if (consent === null) {
    throw new Error("Consent not accepted. Run `bun run cli -- consent accept` first.");
  }
  return consent;
}

loadEnvFile(join(process.cwd(), ".env.local"));

const program = new Command();

program
  .name("bip")
  .description("BIP — payments and auth for autonomous agents")
  .option("--json", "Output JSON");

program
  .command("config:set-base-url")
  .requiredOption("--url <url>", "Convex HTTP actions base URL")
  .action((args: { url: string }) => {
    setConfig({ baseUrl: args.url });
    const globalOpts = program.opts<{ json?: boolean }>();
    print({ baseUrl: args.url }, Boolean(globalOpts.json));
  });

const consent = program.command("consent").description("Manage local consent and agent identity");

function generateStableAgentId(): string {
  const hex = randomBytes(12).toString("hex");
  return `bip_${hex}`;
}

consent.command("accept").action(() => {
  const existing = getConsent();
  const agentId = existing?.agentId ?? generateStableAgentId();
  const next: Consent = {
    tosVersion: "1.2-demo",
    acceptedAt: new Date().toISOString(),
    agentId,
  };
  setConsent(next);
  persistAgentId(agentId);
  const globalOpts = program.opts<{ json?: boolean }>();
  print(next, Boolean(globalOpts.json));
});

consent.command("check").action(() => {
  const existing = getConsent();
  const agentId = getAgentId();
  const globalOpts = program.opts<{ json?: boolean }>();
  if (existing === null && agentId === null) {
    print({ accepted: false, agentId: null }, Boolean(globalOpts.json));
    return;
  }
  print({ accepted: existing !== null, agentId: agentId ?? undefined, ...existing }, Boolean(globalOpts.json));
});

program
  .command("agent-id")
  .description("Print the current agent identity (persist this for Browser Use, AgentMail, credentials)")
  .action(() => {
    const agentId = getAgentId();
    const globalOpts = program.opts<{ json?: boolean }>();
    if (agentId === null) {
      print({ agentId: null, hint: "Run 'consent accept' or 'login' with x-agent-id: bootstrap first" }, Boolean(globalOpts.json));
      return;
    }
    print({ agentId }, Boolean(globalOpts.json));
  });

program
  .command("login")
  .option(
    "--invite-code <inviteCode>",
    `Invite code (or set ${INVITE_CODE_ENV_VAR})`,
  )
  .option(
    "--captcha-token <captchaToken>",
    "hCaptcha response token",
    HCAPTCHA_TEST_RESPONSE_TOKEN,
  )
  .action(async (args: { inviteCode?: string; captchaToken: string }) => {
    const inviteCode =
      args.inviteCode?.trim() ?? process.env[INVITE_CODE_ENV_VAR]?.trim() ?? "";
    if (inviteCode.length === 0) {
      throw new Error(
        `Invite code required. Pass --invite-code or set ${INVITE_CODE_ENV_VAR}.`,
      );
    }
    const baseUrl = getConfig().baseUrl;
    const result = await postJson<LoginResponse>(
      baseUrl,
      "/auth/login",
      {
        captchaToken: args.captchaToken,
        inviteCode,
      },
      null,
    );
    saveCredentials({
      accessToken: result.accessToken,
      expiresAt: result.expiresAt * 1000,
      baseUrl,
    });
    if (typeof result.agentId === "string" && result.agentId.length > 0) {
      persistAgentId(result.agentId);
    }
    const globalOpts = program.opts<{ json?: boolean }>();
    print(
      {
        ok: true,
        agentId: result.agentId,
        expiresAt: new Date(result.expiresAt * 1000).toISOString(),
        maxApiCalls: result.maxApiCalls,
        remainingApiCalls: result.remainingApiCalls,
      },
      Boolean(globalOpts.json),
    );
  });

program.command("logout").action(async () => {
  const credentials = loadCredentials();
  if (credentials !== null) {
    await postJson<{ ok: boolean }>(credentials.baseUrl, "/auth/logout", {}, credentials.accessToken);
  }
  clearCredentials();
  const globalOpts = program.opts<{ json?: boolean }>();
  print({ ok: true }, Boolean(globalOpts.json));
});

const user = program.command("user").description("User commands");

user.command("retrieve").action(async () => {
  const data = await callProtectedTool<UserRetrieveResponse>("/api/tools/user_retrieve", {});
  const globalOpts = program.opts<{ json?: boolean }>();
  print(data, Boolean(globalOpts.json));
});

program
  .command("create_agentmail")
  .requiredOption("--email <email>", "Requested AgentMail inbox email")
  .action(async (args: { email: string }) => {
    const data = await callProtectedTool<CreateAgentmailResponse>(
      "/api/tools/create_agentmail",
      {
        email: args.email,
      },
    );
    const globalOpts = program.opts<{ json?: boolean }>();
    print(data, Boolean(globalOpts.json));
  });

program
  .command("delete_agentmail")
  .requiredOption("--inbox-id <inboxId>", "AgentMail inbox id (typically the inbox email)")
  .action(async (args: { inboxId: string }) => {
    const data = await callProtectedTool<DeleteAgentmailResponse>(
      "/api/tools/delete_agentmail",
      {
        inboxId: args.inboxId,
      },
    );
    const globalOpts = program.opts<{ json?: boolean }>();
    print(data, Boolean(globalOpts.json));
  });

program
  .command("wallet_register")
  .requiredOption("--chain <chain>", "Chain, e.g. solana")
  .requiredOption("--address <address>", "Wallet address")
  .option("--label <label>", "Optional label")
  .action(async (args: { chain: string; address: string; label?: string }) => {
    const data = await callProtectedTool<GenericOk>("/api/tools/register_wallet", {
      chain: args.chain,
      address: args.address,
      label: args.label,
    });
    const globalOpts = program.opts<{ json?: boolean }>();
    print(data, Boolean(globalOpts.json));
  });

program
  .command("wallet_balance")
  .option("--chain <chain>", "Chain, default solana", "solana")
  .action(async (args: { chain: string }) => {
    const data = await callProtectedTool<GenericOk>("/api/tools/wallet_balance", {
      chain: args.chain,
    });
    const globalOpts = program.opts<{ json?: boolean }>();
    print(data, Boolean(globalOpts.json));
  });

program
  .command("intent_create")
  .requiredOption("--task <task>", "Task description")
  .option("--budget-usd <budgetUsd>", "Budget in USD", "5")
  .option("--rail <rail>", "auto|x402|bitrefill|card", "auto")
  .action(async (args: { task: string; budgetUsd: string; rail: string }) => {
    const data = await callProtectedTool<GenericOk>("/api/tools/create_intent", {
      task: args.task,
      budgetUsd: Number(args.budgetUsd),
      rail: args.rail,
    });
    const globalOpts = program.opts<{ json?: boolean }>();
    print(data, Boolean(globalOpts.json));
  });

program
  .command("intent_approve")
  .requiredOption("--intent-id <intentId>", "Intent id")
  .action(async (args: { intentId: string }) => {
    const data = await callProtectedTool<GenericOk>("/api/tools/approve_intent", {
      intentId: args.intentId,
    });
    const globalOpts = program.opts<{ json?: boolean }>();
    print(data, Boolean(globalOpts.json));
  });

program
  .command("intent_execute")
  .requiredOption("--intent-id <intentId>", "Intent id")
  .action(async (args: { intentId: string }) => {
    const data = await callProtectedTool<GenericOk>("/api/tools/execute_intent", {
      intentId: args.intentId,
    });
    const globalOpts = program.opts<{ json?: boolean }>();
    print(data, Boolean(globalOpts.json));
  });

program
  .command("run_status")
  .requiredOption("--run-id <runId>", "Run id")
  .action(async (args: { runId: string }) => {
    const data = await callProtectedTool<GenericOk>("/api/tools/run_status", {
      runId: args.runId,
    });
    const globalOpts = program.opts<{ json?: boolean }>();
    print(data, Boolean(globalOpts.json));
  });

program
  .command("intent_status")
  .requiredOption("--intent-id <intentId>", "Intent id")
  .action(async (args: { intentId: string }) => {
    const data = await callProtectedTool<GenericOk>("/api/tools/intent_status", {
      intentId: args.intentId,
    });
    const globalOpts = program.opts<{ json?: boolean }>();
    print(data, Boolean(globalOpts.json));
  });

// Bootstrap command — zero-touch provisioning
program
  .command("bootstrap")
  .description("Zero-touch bootstrap: auto-provision all API keys and services")
  .option("--skip-cj", "Skip CJ Dropshipping signup")
  .option("--skip-llm", "Skip LLM provider signup")
  .option("--skip-shopify", "Skip Shopify store creation")
  .option("--skip-x", "Skip X account provisioning")
  .action(async (args: { skipCj?: boolean; skipLlm?: boolean; skipShopify?: boolean; skipX?: boolean }) => {
    const { bootstrap } = await import("./bootstrap");
    await bootstrap({
      skipCj: args.skipCj,
      skipLlm: args.skipLlm,
      skipShopify: args.skipShopify,
      skipX: args.skipX,
    });
  });

// Shopify autopilot commands
import { registerShopifyCommands } from "../shopify/cli";
registerShopifyCommands(program);

program.parseAsync().catch((error: unknown) => {
  const message = toErrorMessage(error);
  console.error(message);
  process.exit(1);
});
