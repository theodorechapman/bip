#!/usr/bin/env node

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
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
  refreshToken: string;
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
  email: string;
  otpSent: boolean;
  expiresAt: number;
  debugCode: string;
};

type VerifyResponse = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

type UserRetrieveResponse = {
  id: string;
  email: string;
};

const CLI_VERSION = "0.1.0";
const CONFIG_DIR = join(homedir(), ".config", "moonpay-agent-auth-demo");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const CONSENT_FILE = join(CONFIG_DIR, "consent.json");
const CREDENTIALS_FILE = join(CONFIG_DIR, "credentials.json");
const CREDENTIALS_LOCK_FILE = join(CONFIG_DIR, ".credentials.lock");
const ENCRYPTION_KEY_FILE = join(CONFIG_DIR, ".encryption-key");

const SCRYPT_N = 2 ** 18;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LEN = 32;
const SCRYPT_MAX_MEM = 512 * 1024 * 1024;
const ACCESS_TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000;
const LOCK_STALE_MS = 30 * 1000;
const HCAPTCHA_TEST_RESPONSE_TOKEN = "10000000-aaaa-bbbb-cccc-000000000001";

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
      typeof parsed.refreshToken !== "string" ||
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function acquireRefreshLock(): (() => void) | null {
  ensureConfigDir();
  try {
    const fd = openSync(CREDENTIALS_LOCK_FILE, "wx", 0o600);
    writeFileSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now() }));
    closeSync(fd);
    return () => {
      try {
        unlinkSync(CREDENTIALS_LOCK_FILE);
      } catch {
        // no-op
      }
    };
  } catch (error) {
    const asErr = error as NodeJS.ErrnoException;
    if (asErr.code !== "EEXIST") {
      throw error;
    }
    const existing = readJsonFile<{ pid: number; ts: number }>(CREDENTIALS_LOCK_FILE);
    if (existing !== null && Date.now() - existing.ts < LOCK_STALE_MS) {
      return null;
    }
    try {
      unlinkSync(CREDENTIALS_LOCK_FILE);
    } catch {
      // no-op
    }
    try {
      const fd = openSync(CREDENTIALS_LOCK_FILE, "wx", 0o600);
      writeFileSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now() }));
      closeSync(fd);
      return () => {
        try {
          unlinkSync(CREDENTIALS_LOCK_FILE);
        } catch {
          // no-op
        }
      };
    } catch {
      return null;
    }
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

async function refreshCredentials(
  baseUrl: string,
  credentials: Credentials,
  force: boolean = false,
): Promise<Credentials> {
  const release = acquireRefreshLock();
  if (release === null) {
    await sleep(2000);
    const latest = loadCredentials();
    if (latest !== null && (force || latest.expiresAt > Date.now() + 60_000)) {
      return latest;
    }
    throw new Error("Token refresh failed (concurrent refresh in progress)");
  }
  try {
    const latest = loadCredentials();
    if (latest !== null && !force && latest.expiresAt > Date.now() + 60_000) {
      return latest;
    }
    const refreshed = await postJson<VerifyResponse>(
      baseUrl,
      "/auth/refresh",
      { refreshToken: credentials.refreshToken },
      null,
    );
    const next: Credentials = {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt * 1000,
      baseUrl,
    };
    saveCredentials(next);
    return next;
  } finally {
    release();
  }
}

async function callProtectedTool<T>(path: string, body: unknown): Promise<T> {
  const credentials = loadCredentials();
  if (credentials === null) {
    throw new Error("Not logged in. Run `npm run cli -- login --email you@example.com` first.");
  }
  const baseUrl = credentials.baseUrl;
  let current = credentials;
  if (Date.now() >= current.expiresAt - ACCESS_TOKEN_REFRESH_WINDOW_MS) {
    current = await refreshCredentials(baseUrl, current);
  }
  try {
    return await postJson<T>(baseUrl, path, body, current.accessToken);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) {
      throw error;
    }
    current = await refreshCredentials(baseUrl, current);
    return await postJson<T>(baseUrl, path, body, current.accessToken);
  }
}

function print(value: unknown, asJson: boolean): void {
  if (asJson || typeof value === "object") {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(value);
}

function requireConsent(): Consent {
  const consent = getConsent();
  if (consent === null) {
    throw new Error("Consent not accepted. Run `npm run cli -- consent accept` first.");
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
  .requiredOption("--email <email>", "User email")
  .option(
    "--captcha-token <captchaToken>",
    "hCaptcha response token",
    HCAPTCHA_TEST_RESPONSE_TOKEN,
  )
  .action(async (args: { email: string; captchaToken: string }) => {
    requireConsent();
    const baseUrl = getConfig().baseUrl;
    const result = await postJson<LoginResponse>(
      baseUrl,
      "/auth/login",
      {
        email: args.email,
        captchaToken: args.captchaToken,
      },
      null,
    );
    const globalOpts = program.opts<{ json?: boolean }>();
    print(
      {
        email: result.email,
        otpSent: result.otpSent,
        expiresAt: new Date(result.expiresAt).toISOString(),
        debugCode: result.debugCode,
      },
      Boolean(globalOpts.json),
    );
  });

program
  .command("verify")
  .requiredOption("--email <email>", "User email")
  .requiredOption("--code <code>", "6-digit OTP code")
  .action(async (args: { email: string; code: string }) => {
    requireConsent();
    const baseUrl = getConfig().baseUrl;
    const verified = await postJson<VerifyResponse>(
      baseUrl,
      "/auth/verify",
      { email: args.email, code: args.code },
      null,
    );
    saveCredentials({
      accessToken: verified.accessToken,
      refreshToken: verified.refreshToken,
      expiresAt: verified.expiresAt * 1000,
      baseUrl,
    });
    const globalOpts = program.opts<{ json?: boolean }>();
    print(
      {
        ok: true,
        expiresAt: new Date(verified.expiresAt * 1000).toISOString(),
      },
      Boolean(globalOpts.json),
    );
  });

program.command("refresh").action(async () => {
  const credentials = loadCredentials();
  if (credentials === null) {
    throw new Error("Not logged in.");
  }
  const next = await refreshCredentials(credentials.baseUrl, credentials, true);
  const globalOpts = program.opts<{ json?: boolean }>();
  print(
    {
      ok: true,
      expiresAt: new Date(next.expiresAt).toISOString(),
    },
    Boolean(globalOpts.json),
  );
});

program.command("logout").action(() => {
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

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(message);
  process.exit(1);
});
