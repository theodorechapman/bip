export function renderSkillMarkdown(origin: string): string {
  return `---
name: bip
version: 1.4.0
description: "Managed economic infrastructure for agents: intent in, execution and settlement out."
tags: [agents, commerce, payments, wallets, solana, browser-automation, agentmail, shopify, x]
metadata:
  homepage: ${origin}/skill.md
---

# bip skill.md

bip is managed infrastructure that gives agents economic identity and autonomous spending.

base url: \`${origin}\`

## onboarding (do this first, in order)

### step 1: login
\`\`\`bash
BASE="${origin}"
RESP=$(curl -s -X POST "$BASE/auth/login" \\
  -H "content-type: application/json" \\
  -H "x-agent-id: bootstrap" \\
  -d '{}')
TOKEN=$(echo "$RESP" | jq -r '.accessToken')
AGENT_ID=$(echo "$RESP" | jq -r '.agentId')
\`\`\`
persist TOKEN and AGENT_ID for all subsequent calls.

### step 2: generate your wallet
\`\`\`bash
curl -s -X POST "$BASE/api/tools/wallet_generate" \\
  -H "authorization: Bearer $TOKEN" \\
  -H "x-agent-id: $AGENT_ID" \\
  -H "content-type: application/json" -d '{}'
\`\`\`
returns \`{ address, chain, secretRef }\`. save the address.

### step 3: ask your operator to fund you
**this is critical.** tell your operator (the human running you):

> my bip wallet address is \`<address>\` (solana).
> please fund my account so i can execute intents.
> you can credit me directly via:
> \`curl -X POST ${origin}/api/tools/account_credit -H "authorization: Bearer $TOKEN" -H "x-agent-id: $AGENT_ID" -H "content-type: application/json" -d '{"amountUsd": 20}'\`
> or send SOL to the address above and i will call funding_sync.

**do not create intents until your account is funded.**

### step 4: verify balance
\`\`\`bash
curl -s -X POST "$BASE/api/tools/wallet_balance" \\
  -H "authorization: Bearer $TOKEN" \\
  -H "x-agent-id: $AGENT_ID" \\
  -H "content-type: application/json" -d '{}'
\`\`\`
check that \`account.availableCents > 0\`. if your operator sent SOL, call funding_sync first.

## using intents (only after funding)

1. \`create_intent\` — describe what you want + set budgetUsd
2. auto-approves if budgetUsd <= $10
3. \`execute_intent\` — bip runs browser automation, email verification, payments
4. poll \`intent_status\` every 15s until terminal state

### example: openrouter api key
\`\`\`bash
AUTH=(-H "authorization: Bearer $TOKEN" -H "x-agent-id: $AGENT_ID" -H "content-type: application/json")

INTENT_ID=$(curl -s -X POST "$BASE/api/tools/create_intent" "\${AUTH[@]}" \\
  -d '{"task":"get me an OpenRouter API key","intentType":"api_key_purchase","provider":"openrouter","budgetUsd":5,"metadata":{"provider":"openrouter","accountEmailMode":"agentmail"}}' | jq -r '.intentId')

curl -s -X POST "$BASE/api/tools/execute_intent" "\${AUTH[@]}" \\
  -d "{\\"intentId\\":\\"$INTENT_ID\\"}"

# poll every 15s
while true; do
  S=$(curl -s -X POST "$BASE/api/tools/intent_status" "\${AUTH[@]}" -d "{\\"intentId\\":\\"$INTENT_ID\\"}")
  echo "$S" | jq '{status: .intent.status, events: [.events[] | .eventType]}'
  echo "$S" | jq -r '.intent.status' | grep -qE 'confirmed|failed|action_required' && break
  sleep 15
done
\`\`\`

## offerings

| intentType | provider | what it does |
|---|---|---|
| api_key_purchase | openrouter, elevenlabs | signup + verify + buy credits + extract API key |
| giftcard_purchase | bitrefill | buy gift card via Bitrefill |
| account_bootstrap | bitrefill, x, shopify | create account on provider |
| x_account_bootstrap | x | create X/Twitter account |
| x_post | x | post to X/Twitter |
| cj_account_bootstrap | cj | create CJ Dropshipping account |
| shopify_store_create | shopify | create Shopify store + API token |
| shopify_source_products | cj | source products from CJ |
| shopify_list_products | shopify | list products on Shopify store |
| shopify_fulfill_orders | shopify | fulfill orders via CJ |
| shopify_cycle | shopify | full source + list + fulfill cycle |

## all endpoints

auth:
- POST /auth/login — returns accessToken + agentId
- POST /auth/logout — revoke session

identity:
- POST /api/tools/user_retrieve
- POST /api/tools/agent_bootstrap — provision email + wallet in one call
- POST /api/tools/create_agentmail — \`{"email":"prefix@agentmail.to"}\`
- POST /api/tools/delete_agentmail — \`{"email":"..."}\`

wallet + funding:
- POST /api/tools/wallet_generate — generate Solana wallet
- POST /api/tools/wallet_balance — wallet + account balance
- POST /api/tools/wallet_deposit_address — get deposit address
- POST /api/tools/wallet_transfer — \`{"fromAddress","toAddress","amountSol"}\`
- POST /api/tools/account_credit — \`{"amountUsd":20}\` or \`{"amountCents":2000}\`
- POST /api/tools/register_wallet — register external wallet
- POST /api/tools/funding_sync — scan chain for deposits, credit ledger
- POST /api/tools/funding_status — check funding without crediting

intents:
- POST /api/tools/offering_list — list offerings + policies
- POST /api/tools/create_intent — \`{"task","intentType","provider","budgetUsd","metadata"}\`
- POST /api/tools/approve_intent — \`{"intentId"}\`
- POST /api/tools/execute_intent — \`{"intentId"}\`
- POST /api/tools/intent_status — status + events + funding
- POST /api/tools/intent_resume — resume action_required intent
- POST /api/tools/run_status — execution run details
- POST /api/tools/spend_summary — aggregate spend

other:
- POST /api/tools/shopify_register
- POST /api/tools/secrets_get — \`{"secretRef":"..."}\`
- POST /api/tools/treasury_card_add (admin)
- POST /api/tools/treasury_card_list (admin)
- POST /api/tools/funding_mark_settled (admin)

## notes
- all tool calls: POST with \`Authorization: Bearer <token>\` and \`X-Agent-Id: <agentId>\`
- first login: \`x-agent-id: bootstrap\` auto-generates an agent ID; persist it
- auto-approval: budgetUsd <= $10
- **always generate wallet and get funded before creating intents**
- bip handles browser automation, email verification, payments, credential storage
`;
}

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
    "  elif [ -c /dev/urandom ]; then",
    "    printf 'bip_%s' \"$(head -c 12 /dev/urandom | xxd -p -c 24 2>/dev/null || head -c 12 /dev/urandom | od -A n -t x1 | tr -d ' \\n' | head -c 24)\"",
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
    'echo ""',
    'echo "Next steps:"',
    `echo "  1. Read the skill: curl -s ${SH_BASE}/skill.md"`,
    `echo "  2. Export: export BIP_AGENT_ID=${SH_AID}"`,
    `echo "  3. Follow the onboarding steps in skill.md (login → wallet → fund → intents)"`,
  ].join("\n");
}

const INSTALL_SCRIPT_TEMPLATE = buildInstallScript();

export function renderInstallScript(origin: string): string {
  return INSTALL_SCRIPT_TEMPLATE.replaceAll("__ORIGIN__", origin);
}
