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

const CLI_VERSION = "${CLI_VERSION}";
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
  login --invite-code <code>
  user retrieve
  create_agentmail --email <email>
  delete_agentmail --inbox-id <inboxId>
  rent_phone [--area-code <areaCode>]
  release_phone --number-id <numberId>
  logout
  uninstall
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
    const inviteCode = popOption(args, "--invite-code");
    expectNoExtraArgs(args);
    if (inviteCode === null || inviteCode.trim().length === 0) {
      throw new Error("Invite code required. Pass --invite-code.");
    }
    const baseUrl = getConfig().baseUrl;
    const challenge = await postJson(
      baseUrl,
      "/auth/captcha-challenge",
      { inviteCode: inviteCode.trim() },
      null,
    );
    const captchaUrl = challenge.captchaUrl;
    console.log("Open this URL to solve the captcha:");
    console.log(captchaUrl);
    try {
      const { execSync } = await import("node:child_process");
      const platform = process.platform;
      if (platform === "darwin") {
        execSync(\`open "\${captchaUrl}"\`, { stdio: "ignore" });
      } else if (platform === "linux") {
        execSync(\`xdg-open "\${captchaUrl}" 2>/dev/null || true\`, { stdio: "ignore" });
      } else if (platform === "win32") {
        execSync(\`start "" "\${captchaUrl}"\`, { stdio: "ignore" });
      }
    } catch {}
    console.error("Waiting for captcha to be solved...");
    const POLL_INTERVAL = 2000;
    const POLL_TIMEOUT = 5 * 60 * 1000;
    const startedAt = Date.now();
    while (Date.now() - startedAt < POLL_TIMEOUT) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
      const pollResp = await fetch(\`\${baseUrl}/auth/captcha-poll\`, {
        method: "POST",
        headers: commonHeaders(),
        body: JSON.stringify({ challengeId: challenge.challengeId }),
      });
      if (pollResp.status === 202) continue;
      if (!pollResp.ok) {
        const errBody = await pollResp.text();
        const errData = errBody.length > 0 ? JSON.parse(errBody) : {};
        throw new Error(errData.error || \`Poll failed (\${pollResp.status})\`);
      }
      const pollData = JSON.parse(await pollResp.text());
      if (pollData.status === "completed") {
        saveCredentials({
          accessToken: pollData.accessToken,
          expiresAt: pollData.expiresAt * 1000,
          baseUrl,
        });
        print(
          {
            ok: true,
            expiresAt: new Date(pollData.expiresAt * 1000).toISOString(),
            maxApiCalls: pollData.maxApiCalls,
            remainingApiCalls: pollData.remainingApiCalls,
          },
          asJson,
        );
        return;
      }
    }
    throw new Error("Timed out waiting for captcha to be solved (5 minutes).");
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

  if (command === "uninstall") {
    expectNoExtraArgs(args);
    const credentials = loadCredentials();
    if (credentials !== null) {
      try {
        await postJson(credentials.baseUrl, "/auth/logout", {}, credentials.accessToken);
      } catch {}
    }
    const { rmSync } = await import("node:fs");
    rmSync(CONFIG_DIR, { recursive: true, force: true });
    const scriptPath = process.argv[1] || "";
    if (scriptPath.length > 0 && existsSync(scriptPath)) {
      unlinkSync(scriptPath);
      print({ ok: true, removed: [CONFIG_DIR, scriptPath] }, asJson);
    } else {
      print({ ok: true, removed: [CONFIG_DIR] }, asJson);
    }
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

  if (command === "rent_phone") {
    const areaCode = popOption(args, "--area-code");
    expectNoExtraArgs(args);
    const body = {};
    if (areaCode !== null && areaCode.trim().length > 0) {
      body.areaCode = areaCode.trim();
    }
    const result = await callProtectedTool("/api/tools/rent_phone", body);
    print(result, asJson);
    return;
  }

  if (command === "release_phone") {
    const numberId = popOption(args, "--number-id");
    expectNoExtraArgs(args);
    if (numberId === null || numberId.trim().length === 0) {
      throw new Error("--number-id is required");
    }
    const result = await callProtectedTool("/api/tools/release_phone", {
      numberId: numberId.trim(),
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

const HCAPTCHA_PAGE_TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BIP hCaptcha</title>
    <style>
      :root {
        color-scheme: light;
      }
      body {
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        margin: 0;
        padding: 32px;
        background: #f4f7fb;
        color: #0f172a;
      }
      .card {
        max-width: 760px;
        margin: 0 auto;
        background: #ffffff;
        border: 1px solid #dbe4ef;
        border-radius: 14px;
        padding: 24px;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
      }
      h1 {
        margin: 0 0 10px 0;
        font-size: 24px;
      }
      p {
        margin: 0 0 12px 0;
        line-height: 1.45;
      }
      code {
        background: #f1f5f9;
        padding: 2px 6px;
        border-radius: 6px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .row {
        margin-top: 14px;
      }
      .muted {
        color: #475569;
      }
    </style>
    <script>
      function getChallengeId() {
        return new URLSearchParams(window.location.search).get("challenge") || "";
      }
      async function onCaptchaSolved(token) {
        var status = document.getElementById("captcha-status");
        var challengeId = getChallengeId();
        if (!challengeId) {
          status.textContent = "Error: no challenge ID in URL. Run bip login to start.";
          return;
        }
        status.textContent = "Solved! Sending to CLI...";
        try {
          var resp = await fetch(window.location.origin + "/auth/captcha-callback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ challengeId: challengeId, captchaToken: token }),
          });
          if (resp.ok) {
            status.textContent = "Done! You can close this tab. The CLI is now logged in.";
            status.style.color = "#16a34a";
            status.style.fontWeight = "bold";
          } else {
            var err = await resp.json();
            status.textContent = "Error: " + (err.error || "Unknown error. Try again.");
          }
        } catch (e) {
          status.textContent = "Network error. Please try again.";
        }
      }
      function onHcaptchaLoad() {
        hcaptcha.render("hcaptcha-container", {
          sitekey: "__HCAPTCHA_SITE_KEY__",
          callback: onCaptchaSolved
        });
      }
    </script>
    <script src="https://js.hcaptcha.com/1/api.js?onload=onHcaptchaLoad&render=explicit" async defer></script>
  </head>
  <body>
    <main class="card">
      <h1>BIP hCaptcha Challenge</h1>
      <p>Solve this captcha. Your CLI will log in automatically.</p>
      <div class="row">
        <div id="hcaptcha-container"></div>
      </div>
      <div class="row">
        <p id="captcha-status" class="muted">Waiting for solve...</p>
      </div>
    </main>
  </body>
</html>
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

export function renderHcaptchaPage(siteKey: string): string {
  return HCAPTCHA_PAGE_TEMPLATE.replaceAll("__HCAPTCHA_SITE_KEY__", siteKey);
}

export function buildCliManifest(baseUrl: string): {
  name: string;
  version: string;
  installUrl: string;
  cliUrl: string;
  captchaUrl: string;
  quickInstall: string;
} {
  return {
    name: "bip-cli",
    version: CLI_VERSION,
    installUrl: `${baseUrl}/cli/install.sh`,
    cliUrl: `${baseUrl}/cli/bip.mjs`,
    captchaUrl: `${baseUrl}/cli/hcaptcha`,
    quickInstall: `curl -fsSL ${baseUrl}/cli/install.sh | sh`,
  };
}
