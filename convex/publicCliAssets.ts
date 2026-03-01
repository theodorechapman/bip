const CLI_VERSION = "0.1.0-public";

const PUBLIC_CLI_SCRIPT_TEMPLATE = `#!/usr/bin/env node
import { randomUUID } from "node:crypto";
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

const DEFAULT_BASE_URL = "__BIP_DEFAULT_BASE_URL__";
const CONFIG_DIR = join(homedir(), ".config", "bip-cli");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const CONSENT_FILE = join(CONFIG_DIR, "consent.json");
const CREDENTIALS_FILE = join(CONFIG_DIR, "credentials.json");

function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

function atomicWrite(filePath, contents, mode) {
  ensureConfigDir();
  const tmpPath = \`\${filePath}.tmp.\${process.pid}\`;
  writeFileSync(tmpPath, contents, { encoding: "utf-8", mode });
  renameSync(tmpPath, filePath);
}

function readJsonFile(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function getConfig() {
  const stored = readJsonFile(CONFIG_FILE);
  if (stored && typeof stored.baseUrl === "string" && stored.baseUrl.length > 0) {
    return stored;
  }
  const envBaseUrl = process.env.BIP_BASE_URL || process.env.CONVEX_SITE_URL;
  if (typeof envBaseUrl === "string" && envBaseUrl.length > 0) {
    return { baseUrl: envBaseUrl };
  }
  return { baseUrl: DEFAULT_BASE_URL };
}

function setConfig(config) {
  atomicWrite(CONFIG_FILE, JSON.stringify(config, null, 2), 0o600);
}

function getConsent() {
  return readJsonFile(CONSENT_FILE);
}

function setConsent(consent) {
  atomicWrite(CONSENT_FILE, JSON.stringify(consent, null, 2), 0o600);
}

function requireConsent() {
  const consent = getConsent();
  if (consent === null || typeof consent.agentId !== "string" || consent.agentId.length === 0) {
    throw new Error("Consent not accepted. Run: bip consent accept");
  }
  return consent;
}

function loadCredentials() {
  const value = readJsonFile(CREDENTIALS_FILE);
  if (
    value &&
    typeof value.accessToken === "string" &&
    typeof value.expiresAt === "number" &&
    typeof value.baseUrl === "string"
  ) {
    return value;
  }
  return null;
}

function saveCredentials(credentials) {
  atomicWrite(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), 0o600);
}

function clearCredentials() {
  if (existsSync(CREDENTIALS_FILE)) {
    unlinkSync(CREDENTIALS_FILE);
  }
}

function removeFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return false;
  }
  args.splice(index, 1);
  return true;
}

function popOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return null;
  }
  if (index === args.length - 1) {
    throw new Error(\`\${name} requires a value\`);
  }
  const value = args[index + 1] || "";
  args.splice(index, 2);
  return value;
}

function expectNoExtraArgs(args) {
  if (args.length > 0) {
    throw new Error(\`Unexpected arguments: \${args.join(" ")}\`);
  }
}

function print(value, asJson) {
  if (asJson || typeof value === "object") {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(String(value));
}

function helpText() {
  return \`bip \${CLI_VERSION}

Usage:
  bip [--json] <command> [subcommand] [options]

Commands:
  config:set-base-url --url <url>
  consent accept
  consent check
  login [--invite-code <code>] [--captcha-token <token>]
  user retrieve
  create_agentmail --email <email>
  delete_agentmail --inbox-id <inboxId>
  logout
\`;
}

function commonHeaders() {
  const headers = {
    "Content-Type": "application/json",
    "X-CLI-Version": CLI_VERSION,
  };
  const consent = getConsent();
  if (consent && typeof consent.agentId === "string" && consent.agentId.length > 0) {
    headers["X-Agent-Id"] = consent.agentId;
  }
  return headers;
}

async function postJson(baseUrl, path, body, token) {
  const headers = commonHeaders();
  if (typeof token === "string" && token.length > 0) {
    headers.Authorization = \`Bearer \${token}\`;
  }
  const response = await fetch(\`\${baseUrl}\${path}\`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const data = text.length > 0 ? JSON.parse(text) : null;
  if (!response.ok) {
    const message =
      data &&
      typeof data === "object" &&
      typeof data.error === "string"
        ? data.error
        : \`Request failed (\${response.status})\`;
    throw new Error(message);
  }
  return data;
}

async function callProtectedTool(path, body) {
  const credentials = loadCredentials();
  if (credentials === null) {
    throw new Error("Not logged in. Run: bip login");
  }
  if (Date.now() >= credentials.expiresAt) {
    clearCredentials();
    throw new Error("Session expired. Run: bip login");
  }
  return await postJson(credentials.baseUrl, path, body, credentials.accessToken);
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = removeFlag(args, "--json");
  const command = args.shift() || "";

  if (command.length === 0 || command === "help" || command === "--help" || command === "-h") {
    print(helpText(), false);
    return;
  }

  if (command === "config:set-base-url") {
    const url = popOption(args, "--url");
    expectNoExtraArgs(args);
    if (url === null || url.trim().length === 0) {
      throw new Error("--url is required");
    }
    setConfig({ baseUrl: url.trim() });
    print({ baseUrl: url.trim() }, asJson);
    return;
  }

  if (command === "consent") {
    const subcommand = args.shift() || "";
    expectNoExtraArgs(args);
    if (subcommand === "accept") {
      const existing = getConsent();
      const next = {
        tosVersion: "1.2-demo",
        acceptedAt: new Date().toISOString(),
        agentId:
          existing && typeof existing.agentId === "string" && existing.agentId.length > 0
            ? existing.agentId
            : randomUUID(),
      };
      setConsent(next);
      print(next, asJson);
      return;
    }
    if (subcommand === "check") {
      const consent = getConsent();
      if (consent === null) {
        print({ accepted: false }, asJson);
        return;
      }
      print({ accepted: true, ...consent }, asJson);
      return;
    }
    throw new Error("Usage: bip consent <accept|check>");
  }

  if (command === "login") {
    requireConsent();
    const inviteCode =
      popOption(args, "--invite-code") ||
      (typeof process.env.BIP_INVITE_CODE === "string"
        ? process.env.BIP_INVITE_CODE.trim()
        : "");
    const captchaToken =
      popOption(args, "--captcha-token") ||
      "10000000-aaaa-bbbb-cccc-000000000001";
    expectNoExtraArgs(args);
    if (inviteCode.length === 0) {
      throw new Error("Invite code required. Pass --invite-code or set BIP_INVITE_CODE.");
    }
    const baseUrl = getConfig().baseUrl;
    const result = await postJson(
      baseUrl,
      "/auth/login",
      { inviteCode, captchaToken },
      null,
    );
    saveCredentials({
      accessToken: result.accessToken,
      expiresAt: result.expiresAt * 1000,
      baseUrl,
    });
    print(
      {
        ok: true,
        expiresAt: new Date(result.expiresAt * 1000).toISOString(),
        maxApiCalls: result.maxApiCalls,
        remainingApiCalls: result.remainingApiCalls,
      },
      asJson,
    );
    return;
  }

  if (command === "logout") {
    expectNoExtraArgs(args);
    const credentials = loadCredentials();
    if (credentials !== null) {
      await postJson(credentials.baseUrl, "/auth/logout", {}, credentials.accessToken);
    }
    clearCredentials();
    print({ ok: true }, asJson);
    return;
  }

  if (command === "user") {
    const subcommand = args.shift() || "";
    expectNoExtraArgs(args);
    if (subcommand !== "retrieve") {
      throw new Error("Usage: bip user retrieve");
    }
    const result = await callProtectedTool("/api/tools/user_retrieve", {});
    print(result, asJson);
    return;
  }

  if (command === "create_agentmail") {
    const email = popOption(args, "--email");
    expectNoExtraArgs(args);
    if (email === null || email.trim().length === 0) {
      throw new Error("--email is required");
    }
    const result = await callProtectedTool("/api/tools/create_agentmail", {
      email: email.trim(),
    });
    print(result, asJson);
    return;
  }

  if (command === "delete_agentmail") {
    const inboxId = popOption(args, "--inbox-id");
    expectNoExtraArgs(args);
    if (inboxId === null || inboxId.trim().length === 0) {
      throw new Error("--inbox-id is required");
    }
    const result = await callProtectedTool("/api/tools/delete_agentmail", {
      inboxId: inboxId.trim(),
    });
    print(result, asJson);
    return;
  }

  throw new Error(\`Unknown command: \${command}\`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(message);
  process.exit(1);
});
`;

const INSTALL_SCRIPT_TEMPLATE = `#!/usr/bin/env sh
set -eu

BASE_URL="\${BIP_CLI_BASE_URL:-__BIP_DEFAULT_BASE_URL__}"
INSTALL_DIR="\${BIP_INSTALL_DIR:-$HOME/.local/bin}"
BIN_NAME="\${BIP_BIN_NAME:-bip}"
TARGET="$INSTALL_DIR/$BIN_NAME"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to run the BIP CLI" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
    return
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
    return
  fi
  echo "curl or wget is required to download the CLI" >&2
  exit 1
}

download "$BASE_URL/cli/bip.mjs" "$TARGET"
chmod +x "$TARGET"

echo "Installed BIP CLI to: $TARGET"
echo "Add to PATH if needed: export PATH=\\"$INSTALL_DIR:$PATH\\""
echo "Then run: $BIN_NAME --help"
`;

function replaceBaseUrl(template: string, baseUrl: string): string {
  return template.replaceAll("__BIP_DEFAULT_BASE_URL__", baseUrl);
}

export function renderPublicCliScript(baseUrl: string): string {
  return replaceBaseUrl(PUBLIC_CLI_SCRIPT_TEMPLATE, baseUrl);
}

export function renderInstallScript(baseUrl: string): string {
  return replaceBaseUrl(INSTALL_SCRIPT_TEMPLATE, baseUrl);
}

export function buildCliManifest(baseUrl: string): {
  name: string;
  version: string;
  installUrl: string;
  cliUrl: string;
  quickInstall: string;
} {
  return {
    name: "bip-cli",
    version: CLI_VERSION,
    installUrl: `${baseUrl}/cli/install.sh`,
    cliUrl: `${baseUrl}/cli/bip.mjs`,
    quickInstall: `curl -fsSL ${baseUrl}/cli/install.sh | sh`,
  };
}


export function renderSkillMarkdown(origin: string): string {
  return `---
name: bip
version: 1.1.0
description: "Hosted agent commerce runtime: authenticated paid intents in, fulfillment artifacts out."
tags: [agents, commerce, payments, x402, gift-cards, api-keys, automation]
metadata:
  openclaw:
    emoji: "🧠"
  homepage: ${origin}/skill.md
---

# bip skill.md

bip is infrastructure for autonomous agents.

agents should only need to:
1) authenticate
2) pay/fund access (x402/wallet policy)
3) request intents

bip handles the rest: execution orchestration, checkout/payment workflows, artifact return, tracing, and ledger audit.

base url: \`${origin}\`

## production flow

\`\`\`bash
TOKEN=$(curl -s -X POST "${origin}/auth/login" \
  -H "content-type: application/json" \
  -H "x-agent-id: agent-$(date +%s)" \
  -d '{"inviteCode":"opalbip2026","captchaToken":"10000000-aaaa-bbbb-cccc-000000000001"}' | jq -r '.accessToken')

INTENT=$(curl -s -X POST "${origin}/api/tools/create_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"intentType":"giftcard_purchase","provider":"bitrefill","task":"buy $10 card and return fulfillment","budgetUsd":10,"rail":"auto"}' | jq -r '.intentId')

curl -s -X POST "${origin}/api/tools/execute_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-idempotency-key: exec-$INTENT-1" \
  -H "content-type: application/json" \
  -d "{\"intentId\":\"$INTENT\"}" | jq
\`\`\`

## core endpoints
- POST /auth/login
- POST /api/tools/create_intent
- POST /api/tools/approve_intent
- POST /api/tools/execute_intent
- POST /api/tools/intent_resume
- POST /api/tools/intent_status
- POST /api/tools/run_status

## notes
- provider allowlist + idempotency enforced
- outputs include run/trace ids and fulfillment artifacts
- secrets are returned by reference (secretRef)
`;
}
