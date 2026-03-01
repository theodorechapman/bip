# BIP — Browser Identity & Payments for Agents

BIP is identity, auth, and payments infrastructure for autonomous agents.

**Pitch:**
- Real email identity
- Real auth + long-lived session continuity
- Real web payments (x402 + checkout fill)
- One runtime for intents (`intent_create -> intent_execute -> artifacts`)

This repo includes the hosted API/runtime + CLI surfaces used in the Browser Use hackathon build.

## What works right now

1. Agent auth (`/auth/login`) with invite + hCaptcha controls
2. Session issuance + quota enforcement
3. Agent wallet provisioning + Solana deposit address
4. Funding sync from inbound Solana txs (`funding_sync`)
5. Intent lifecycle (`create`, `approve`, `execute`, `status`, `resume`)
6. Payment rails abstraction (`x402` + browser checkout fill)
7. Credential/artifact outputs by reference (`secretRef`, `proofRef`, `traceId`)
8. Treasury card refs for backend checkout flows (no raw PAN/CVV in intent payloads)

## Stack

- Convex HTTP actions + Convex DB
- TypeScript CLI (`commander`)
- Local credential encryption (`aes-256-gcm` + `scrypt`)

## Install

```bash
bun install
```

## Start Convex local deployment

```bash
bun run convex:dev
```

This starts local Convex and writes `.env.local` including:

- `CONVEX_URL`
- `CONVEX_SITE_URL`

## Agent onboarding

Agents talk HTTP — no CLI install needed. Read the skill manifest to discover available intents:

```bash
curl -fsSL https://exciting-stingray-685.convex.site/skill.md
```

Authenticate and start making requests:

```bash
TOKEN=$(curl -s -X POST "https://exciting-stingray-685.convex.site/auth/login" \
  -H "content-type: application/json" \
  -H "x-agent-id: agent-$(date +%s)" \
  -d '{"inviteCode":"<invite-code>","captchaToken":"10000000-aaaa-bbbb-cccc-000000000001"}' \
  | jq -r '.accessToken')
```

Session tokens are valid for 24 hours.

### Invite code setup

Set an invite code gate on Convex:

```bash
bunx convex env set INVITE_CODES "<invite-code>"
```

For production:

```bash
bunx convex env set --prod INVITE_CODES "<invite-code>"
```

You can set multiple codes as a comma-separated list:

```bash
bunx convex env set --prod INVITE_CODES "code-a,code-b,code-c"
```

Optional local convenience for CLI:

```bash
export BIP_INVITE_CODE="<invite-code>"
```

### hCaptcha setup

Set environment variables on Convex for your deployment:

```bash
bunx convex env set HCAPTCHA_SECRET_KEY "<your-hcaptcha-secret>"
bunx convex env set HCAPTCHA_SITE_KEY "<your-hcaptcha-site-key>"
```

For production:

```bash
bunx convex env set --prod HCAPTCHA_SECRET_KEY "<your-hcaptcha-secret>"
bunx convex env set --prod HCAPTCHA_SITE_KEY "<your-hcaptcha-site-key>"
```

For test/demo mode with hCaptcha test keys, use:

- `HCAPTCHA_SITE_KEY=10000000-ffff-ffff-ffff-000000000001`
- `HCAPTCHA_SECRET_KEY=0x0000000000000000000000000000000000000000`

### AgentMail setup

Set backend environment variables:

```bash
bunx convex env set AGENTMAIL_API_KEY "<your-agentmail-api-key>"
```

Optional (defaults to `https://api.agentmail.to`):

```bash
bunx convex env set AGENTMAIL_BASE_URL "https://api.agentmail.to"
```

For production:

```bash
bunx convex env set --prod AGENTMAIL_API_KEY "<your-agentmail-api-key>"
bunx convex env set --prod AGENTMAIL_BASE_URL "https://api.agentmail.to"
```

## Commands

- `consent accept`
- `consent check`
- `config:set-base-url --url <url>`
- `login --invite-code <code> [--captcha-token <token>]`
- `user retrieve`
- `create_agentmail --email <email>`
- `delete_agentmail --inbox-id <inboxId>`
- `wallet_register --chain <chain> --address <address> [--label <label>]`
- `wallet_balance [--chain <chain>]`
- `intent_create --task <task> [--budget-usd <usd>] [--rail <rail>]`
- `intent_approve --intent-id <intentId>`
- `intent_execute --intent-id <intentId>`
- `intent_status --intent-id <intentId>`
- `run_status --run-id <runId>`
- `logout`

## Tool API endpoints

- `POST /api/tools/offering_list` (phase-1 static offerings + effective policy)
- `POST /api/tools/create_intent` (policy-validated for phase-1 when `intentType` + `provider` are set)
- `POST /api/tools/approve_intent`
- `POST /api/tools/execute_intent`
- `POST /api/tools/intent_resume`
- `POST /api/tools/intent_status` (now includes `holdAmountCents`, `settledAmountCents`, `releasedAmountCents`, `fundingStatus`)
- `POST /api/tools/run_status`
- `POST /api/tools/spend_summary` (per-agent funded/held/settled + totals by provider and intent type)
- `POST /api/tools/treasury_card_add` (admin-gated; stores backend card by `cardRef`)
- `POST /api/tools/treasury_card_list` (admin-gated; masked metadata only)
- `POST /api/tools/wallet_deposit_address` (returns/auto-provisions primary Solana funding address)
- `POST /api/tools/funding_sync` (operator trigger; scans inbound Solana txs and auto-credits unprocessed deposits)
- `POST /api/tools/funding_status` (shows detected inbound Solana txs and credited/uncredited state for current user)
- `POST /api/tools/funding_mark_settled` (admin-gated; credits ledger from settled Solana transfer)

### Payments execution env

For live Browser Use-backed intent execution:

```bash
export BROWSER_USE_API_KEY="<your-bu-api-key>"
# optional
export BROWSER_USE_API_BASE="https://api.browser-use.com"
export ADMIN_CARD_WRITE_TOKEN="<internal-admin-token>"
export DEFAULT_TREASURY_CARD_REF="card_ops_primary_xxxxxx"

# free | metered
export PAYMENTS_MODE="free"
# minimum budget gate in metered mode
export MIN_INTENT_BUDGET_USD="1"
```

## Primary MVP flow: api_key_purchase

```bash
# 1) login
TOKEN=$(curl -s -X POST "$BASE/auth/login" \
  -H "content-type: application/json" \
  -H "x-agent-id: agent-$(date +%s)" \
  -d '{"inviteCode":"opalbip2026","captchaToken":"10000000-aaaa-bbbb-cccc-000000000001"}' \
  | jq -r '.accessToken')

# 2) fund account
curl -s -X POST "$BASE/api/tools/wallet_deposit_address" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{}' | jq '{address, memo, reference}'

curl -s -X POST "$BASE/api/tools/funding_sync" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"maxTx":20}' | jq '{detectedCount, creditedCount, totalCreditedCents}'

# 3) create deterministic api_key_purchase intent
INTENT=$(curl -s -X POST "$BASE/api/tools/create_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"intentType":"api_key_purchase","provider":"elevenlabs","task":"create API key and return proof","budgetUsd":8,"rail":"auto","metadata":{"provider":"elevenlabs","accountEmailMode":"existing","targetProduct":"starter"}}' \
  | jq -r '.intentId')

# 4) execute
curl -s -X POST "$BASE/api/tools/execute_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d "{\"intentId\":\"$INTENT\"}" | jq '{status, provider, traceId, proofRef, credential, artifact, handoffUrl}'
```

## Secondary flow: Treasury card ref + giftcard_purchase

```bash
# 0) admin adds treasury card once (never send PAN/CVV in intent payloads)
CARD_REF=$(curl -s -X POST "$BASE/api/tools/treasury_card_add" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-admin-token: $ADMIN_CARD_WRITE_TOKEN" \
  -H "content-type: application/json" \
  -d '{"label":"ops-primary","pan":"4111111111111111","expMonth":"12","expYear":"2030","cvv":"123","nameOnCard":"Ops Treasury"}' \
  | jq -r '.cardRef')

# 1) agent gets deposit address (wallet auto-generated if missing)
curl -s -X POST "$BASE/api/tools/wallet_deposit_address" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{}' | jq '{address, memo, reference}'

# 2) send SOL on-chain to that address, then trigger auto funding sync
curl -s -X POST "$BASE/api/tools/funding_sync" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"maxTx":20}' | jq '{detectedCount, creditedCount, totalCreditedCents}'

# 3) optional: inspect which txs are credited vs pending
curl -s -X POST "$BASE/api/tools/funding_status" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"maxTx":20}' | jq '{detectedCount, txs}'

# 4) admin override remains available for manual settlement edits
curl -s -X POST "$BASE/api/tools/funding_mark_settled" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-admin-token: $ADMIN_CARD_WRITE_TOKEN" \
  -H "content-type: application/json" \
  -d '{"userIdOrAgentId":"agent-123","amountCents":1000,"txSig":"5f...","chain":"solana"}' | jq

# 5) agent creates giftcard intent (metadata.cardRef optional if DEFAULT_TREASURY_CARD_REF is set)
INTENT=$(curl -s -X POST "$BASE/api/tools/create_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d "{\"intentType\":\"giftcard_purchase\",\"provider\":\"bitrefill\",\"task\":\"buy $10 card and return fulfillment\",\"budgetUsd\":10,\"rail\":\"auto\",\"metadata\":{\"cardRef\":\"$CARD_REF\"}}" \
  | jq -r '.intentId')

# 6) execute; artifacts include payment source marker only (no PAN/CVV)
curl -s -X POST "$BASE/api/tools/execute_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d "{\"intentId\":\"$INTENT\"}" | jq '{status, runId, paymentSource, cardRef}'
```

## Typecheck

```bash
bun run typecheck
```

## Testing

Run the Bun E2E suite:

```bash
bun run test:e2e
```

What it covers:

- invite-code + hCaptcha login gating
- 24-hour session issuance
- per-session API quota enforcement (`100` calls)
- `create_agentmail` and `delete_agentmail`
- one-active-inbox-per-agent enforcement
- CLI flow (`consent`, `login`, tool calls)
- phase-1 offering registry endpoint
- create-intent policy enforcement (allowlist + caps), including `api_key_purchase` metadata contract
- per-agent spend summary totals

The test harness uses local mock providers for hCaptcha and AgentMail.
It simulates AgentMail free-tier behavior with a cap of `3` active inboxes and validates that deleting an inbox frees a slot.


## tracing sinks (optional)

set either/both to mirror run lifecycle events externally:

- `LAMINAR_INGEST_URL` (+ optional `LAMINAR_API_KEY`)
- `HUD_TRACE_URL` (+ optional `HUD_API_KEY`)

payload includes `traceId`, `runId`, `intentId`, phase (`started|rail_selected|failed|confirmed`), status, rail, task metadata, and timing fields.

## Phase-1 offering policy

- Offering policies are persisted in `offeringPolicies` and auto-seeded from `OFFERINGS.md` phase-1 defaults on first use.
- `create_intent` enforces:
  - offering registry match on (`intentType`, `provider`)
  - provider allowlist per offering policy
  - per-intent budget cap and per-day budget cap
  - `api_key_purchase` metadata contract:
    - `provider` (string, required)
    - `accountEmailMode` (`agentmail|existing`, required)
    - `targetProduct` (string, optional)
    - `dryRun` (boolean, optional)
- Legacy mode is preserved when both `intentType` and `provider` are omitted.
