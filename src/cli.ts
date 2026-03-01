#!/usr/bin/env node

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

const CLI_VERSION = "0.1.0";
const CONFIG_DIR = join(homedir(), ".config", "bip-cli");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const CONSENT_FILE = join(CONFIG_DIR, "consent.json");
const CREDENTIALS_FILE = join(CONFIG_DIR, "credentials.json");
const ENCRYPTION_KEY_FILE = join(CONFIG_DIR, ".encryption-key");

const SCRYPT_N = 2 ** 18;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LEN = 32;
const SCRYPT_MAX_MEM = 512 * 1024 * 1024;
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
  const envKey = process.env.BIP_ENCRYPTION_KEY;
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
  const consent = getConsent();
  if (consent !== null) {
    headers["X-Agent-Id"] = consent.agentId;
  }
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

async function callProtectedTool<T>(path: string, body: unknown): Promise<T> {
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
  .name("moonpay-agent-demo")
  .description("Convex demo CLI for MoonPay-style AI agent authentication flow")
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

consent.command("accept").action(() => {
  const existing = getConsent();
  const next: Consent = {
    tosVersion: "1.2-demo",
    acceptedAt: new Date().toISOString(),
    agentId: existing?.agentId ?? crypto.randomUUID(),
  };
  setConsent(next);
  const globalOpts = program.opts<{ json?: boolean }>();
  print(next, Boolean(globalOpts.json));
});

consent.command("check").action(() => {
  const existing = getConsent();
  const globalOpts = program.opts<{ json?: boolean }>();
  if (existing === null) {
    print({ accepted: false }, Boolean(globalOpts.json));
    return;
  }
  print({ accepted: true, ...existing }, Boolean(globalOpts.json));
});

program
  .command("login")
  .option(
    "--invite-code <inviteCode>",
    `Invite code (or set ${INVITE_CODE_ENV_VAR})`,
  )
  .action(async (args: { inviteCode?: string }) => {
    requireConsent();
    const inviteCode =
      args.inviteCode?.trim() ?? process.env[INVITE_CODE_ENV_VAR]?.trim() ?? "";
    if (inviteCode.length === 0) {
      throw new Error(
        `Invite code required. Pass --invite-code or set ${INVITE_CODE_ENV_VAR}.`,
      );
    }
    const baseUrl = getConfig().baseUrl;
    const challenge = await postJson<{ challengeId: string; captchaUrl: string }>(
      baseUrl,
      "/auth/captcha-challenge",
      { inviteCode },
      null,
    );
    console.log("Open this URL to solve the captcha:");
    console.log(challenge.captchaUrl);
    try {
      const { execSync } = await import("node:child_process");
      const platform = process.platform;
      if (platform === "darwin") {
        execSync(`open "${challenge.captchaUrl}"`, { stdio: "ignore" });
      } else if (platform === "linux") {
        execSync(`xdg-open "${challenge.captchaUrl}" 2>/dev/null || true`, { stdio: "ignore" });
      } else if (platform === "win32") {
        execSync(`start "" "${challenge.captchaUrl}"`, { stdio: "ignore" });
      }
    } catch {
      // browser open is best-effort
    }
    console.error("Waiting for captcha to be solved...");
    const POLL_INTERVAL = 2000;
    const POLL_TIMEOUT = 5 * 60 * 1000;
    const startedAt = Date.now();
    while (Date.now() - startedAt < POLL_TIMEOUT) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
      const pollResult = await postJson<{
        status: string;
        accessToken?: string;
        expiresAt?: number;
        maxApiCalls?: number;
        remainingApiCalls?: number;
      }>(
        baseUrl,
        "/auth/captcha-poll",
        { challengeId: challenge.challengeId },
        null,
      );
      if (pollResult.status === "completed" && pollResult.accessToken !== undefined) {
        saveCredentials({
          accessToken: pollResult.accessToken,
          expiresAt: (pollResult.expiresAt ?? 0) * 1000,
          baseUrl,
        });
        const globalOpts = program.opts<{ json?: boolean }>();
        print(
          {
            ok: true,
            expiresAt: new Date((pollResult.expiresAt ?? 0) * 1000).toISOString(),
            maxApiCalls: pollResult.maxApiCalls,
            remainingApiCalls: pollResult.remainingApiCalls,
          },
          Boolean(globalOpts.json),
        );
        return;
      }
    }
    throw new Error("Timed out waiting for captcha to be solved (5 minutes).");
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

// Shopify autopilot commands
import { registerShopifyCommands } from "../shopify/cli";
registerShopifyCommands(program);

const provision = program.command("provision").description("Provision API keys from providers");

provision
  .command("openrouter")
  .description("Sign up for OpenRouter and retrieve an API key")
  .option("--env-file <path>", "Path to .env file to write key to", join(process.cwd(), ".env"))
  .option("--no-save", "Don't save to .env file, just print the key")
  .action(async (args: { envFile: string; save: boolean }) => {
    const { getOpenRouterKey } = await import("./providers/openrouter");
    const key = await getOpenRouterKey();
    if (!key || !/^sk-or-[a-zA-Z0-9_-]+$/.test(key)) {
      console.error("Failed to provision OpenRouter API key.");
      process.exit(1);
    }
    console.log(`\nAPI Key: ${key}`);
    if (args.save) {
      const envVar = "OPENROUTER_API_KEY";
      const envPath = args.envFile;
      let content = "";
      if (existsSync(envPath)) {
        content = readFileSync(envPath, "utf-8");
        const regex = new RegExp(`^${envVar}=.*$`, "m");
        if (regex.test(content)) {
          content = content.replace(regex, `${envVar}=${key}`);
          console.log(`Updated ${envVar} in ${envPath}`);
        } else {
          content = content.trimEnd() + `\n${envVar}=${key}\n`;
          console.log(`Appended ${envVar} to ${envPath}`);
        }
      } else {
        content = `${envVar}=${key}\n`;
        console.log(`Created ${envPath} with ${envVar}`);
      }
      writeFileSync(envPath, content, { encoding: "utf-8" });
    }
  });

provision
  .command("demo-signup")
  .description("Test full agent identity stack (email) by signing up on a site")
  .option("--url <url>", "Target signup URL", "https://github.com/signup")
  .action(async (args: { url: string }) => {
    const { demoSignup } = await import("./providers/demo-signup");
    const result = await demoSignup(args.url);
    if (!result) {
      console.error("Signup failed.");
      process.exit(1);
    }
  });

program.parseAsync().catch((error: unknown) => {
  const message = toErrorMessage(error);
  console.error(message);
  process.exit(1);
});
