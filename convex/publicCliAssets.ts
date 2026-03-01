export function renderSkillMarkdown(origin: string): string {
  return `---
name: bip
version: 1.1.0
description: "Hosted agent commerce runtime: authenticated paid intents in, fulfillment artifacts out."
tags: [agents, commerce, payments, x402, gift-cards, api-keys, automation, shopify, dropshipping]
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

## getting started (HTTP only, no CLI)

Set BASE and call endpoints. First login: \`POST ${origin}/auth/login\` with \`x-agent-id: bootstrap\`. Response includes \`agentId\` and \`accessToken\` — persist both. Send \`x-agent-id\` and \`Authorization: Bearer $TOKEN\` on every tool call.

## quick start

\`\`\`bash
RESP=$(curl -s -X POST "${origin}/auth/login" \\
  -H "content-type: application/json" \\
  -H "x-agent-id: bootstrap" \\
  -d '{"inviteCode":"YOUR_CODE","captchaToken":"10000000-aaaa-bbbb-cccc-000000000001"}')
TOKEN=$(echo "$RESP" | jq -r '.accessToken')
AGENT_ID=$(echo "$RESP" | jq -r '.agentId')

curl -s -X POST "${origin}/api/tools/offering_list" \\
  -H "authorization: Bearer $TOKEN" \\
  -H "x-agent-id: $AGENT_ID" \\
  -d '{}' | jq

INTENT=$(curl -s -X POST "${origin}/api/tools/create_intent" \\
  -H "authorization: Bearer $TOKEN" \\
  -H "x-agent-id: $AGENT_ID" \\
  -H "content-type: application/json" \\
  -d '{"intentType":"shopify_cycle","provider":"shopify","task":"full dropship cycle","budgetUsd":25,"metadata":{"keywords":["trending gadgets"],"maxProducts":5,"marginPct":50}}' | jq -r '.intentId')
curl -s -X POST "${origin}/api/tools/approve_intent" -H "authorization: Bearer $TOKEN" -H "x-agent-id: $AGENT_ID" -H "content-type: application/json" -d "{\\"intentId\\":\\"$INTENT\\"}"
curl -s -X POST "${origin}/api/tools/execute_intent" -H "authorization: Bearer $TOKEN" -H "x-agent-id: $AGENT_ID" -H "x-idempotency-key: exec-$INTENT-1" -H "content-type: application/json" -d "{\\"intentId\\":\\"$INTENT\\"}"
\`\`\`

## core endpoints
- POST /auth/login
- POST /api/tools/offering_list
- POST /api/tools/create_intent
- POST /api/tools/approve_intent
- POST /api/tools/execute_intent
- POST /api/tools/intent_resume
- POST /api/tools/intent_status
- POST /api/tools/run_status
- POST /api/tools/spend_summary
- POST /api/tools/wallet_deposit_address
- POST /api/tools/funding_sync
- POST /api/tools/funding_status
- POST /api/tools/funding_mark_settled (admin override)

## shopify dropshipping

Bootstrap: \`cj_account_bootstrap\` → \`shopify_store_create\` (metadata: storeName, niche) → \`shopify_cycle\`. All via API; BIP stores creds in agentSecrets.

## notes
- no CLI: all operations via POST to \`$BASE/api/tools/*\` with Bearer + \`x-agent-id\`
- first login: \`x-agent-id: bootstrap\`; persist \`agentId\` + \`accessToken\`
- offering registry + policy caps + idempotency enforced
- outputs include run/trace ids and fulfillment artifacts
- secrets are returned by reference (secretRef)
`;
}

// Shell vars in output — use JS vars so we don't trip template interpolation
const SH_HOME = "${HOME}";
const SH_CFG = "${CONFIG_DIR}";
const SH_AID = "${AGENT_ID}";
const SH_AF = "${AGENT_ID_FILE}";
const SH_XF = "${CONFIG_FILE}";
const SH_BASE = "${BIP_BASE}";

function buildInstallScript(): string {
  return [
    "#!/usr/bin/env sh",
    "# BIP one-line install — curl -sSL __ORIGIN__/install.sh | sh",
    "set -e",
    "BIP_BASE=\"__ORIGIN__\"",
    `CONFIG_DIR="${SH_HOME}/.config/bip"`,
    `AGENT_ID_FILE="${SH_CFG}/agent-id"`,
    `CONFIG_FILE="${SH_CFG}/config.json"`,
    "generate_agent_id() {",
    "  if command -v openssl >/dev/null 2>&1; then",
    "    printf 'bip_%s' \"$(openssl rand -hex 12)\"",
    "  else",
    '    printf \'bip_%s%04d\' "$(date +%s)" "$$"',
    "  fi",
    "}",
    `mkdir -p "${SH_CFG}"`,
    `chmod 700 "${SH_CFG}"`,
    "AGENT_ID=$(generate_agent_id)",
    `printf '%s' "${SH_AID}" > "${SH_AF}"`,
    `chmod 600 "${SH_AF}"`,
    `printf '%s\\n' "{\\"baseUrl\\":\\"${SH_BASE}\\"}" > "${SH_XF}"`,
    `chmod 600 "${SH_XF}"`,
    'echo "BIP installed."',
    `echo "  config: ${SH_CFG}"`,
    `echo "  agentId: ${SH_AID}"`,
    `echo "skill.md: ${SH_BASE}/skill.md"`,
  ].join("\n");
}

const INSTALL_SCRIPT_TEMPLATE = buildInstallScript();

export function renderInstallScript(origin: string): string {
  return INSTALL_SCRIPT_TEMPLATE.replaceAll("__ORIGIN__", origin);
}
