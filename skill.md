---
name: bip
version: 1.1.0
description: "Hosted agent commerce runtime: authenticated paid intents in, fulfillment artifacts out."
tags: [agents, commerce, payments, x402, gift-cards, api-keys, automation]
metadata:
  openclaw:
    emoji: "🧠"
  homepage: https://wonderful-goose-918.convex.site/skill.md
---

# bip skill.md

bip is infrastructure for autonomous agents.

agents should only need to:
1) authenticate
2) pay/fund access (x402/wallet policy)
3) request intents

bip handles the rest:
- execution orchestration
- checkout/payment workflows
- artifact return (codes/keys/receipts)
- trace + ledger audit

primary MVP path: `api_key_purchase`  
secondary: `giftcard_purchase`, `cj_account_bootstrap` (per-agent CJ credentials for dropshipping)

## getting started (no CLI required)

all operations are HTTP. set `BASE` and call the endpoints directly.

```bash
BASE="https://wonderful-goose-918.convex.site"
```

optional: `curl -sSL $BASE/install.sh | sh` creates `~/.config/bip` with a pre-generated agentId. or skip it — first login with `x-agent-id: bootstrap` returns an agentId; persist it for all future requests.

## agent bootstrap sequence (dropship demo)

to bootstrap an agent for "manage your own Shopify dropship site":

1. **login** (bootstrap) — get agentId, persist it  
2. **fund** — wallet_deposit_address, send SOL, funding_sync  
3. **api_key_purchase** (OpenRouter) — get LLM key for product copy  
4. **cj_account_bootstrap** — get CJ Dropshipping credentials (stored per agent)  
5. **shopify_store_create** intent — BIP creates the Shopify store and stores creds in agentSecrets. Metadata: `storeName`, `niche`.
6. **shopify_cycle** — source, list, fulfill (uses per-agent CJ creds and registered Shopify store)

all via `POST $BASE/api/tools/<endpoint>` with `Authorization: Bearer $TOKEN` and `x-agent-id: $AGENT_ID`.

## agent identity (required for Browser Use profiles, AgentMail, credentials)

agents must use a **stable, persistent agentId**. send it on every request as header `x-agent-id: <agentId>`.

1. **bootstrap (first run)**: send `x-agent-id: bootstrap`. BIP generates and returns `agentId` (e.g. `bip_a1b2c3...`). persist it in your config/store.
2. **persisted id**: send your existing agentId as `x-agent-id` on every request.

login response includes `agentId` — store it. without it, each login creates a new agent and you lose profiles, inboxes, and credentials.

## production flow (default)

```bash
# 1) login (first run: x-agent-id bootstrap; persist agentId + accessToken)
RESP=$(curl -s -X POST "$BASE/auth/login" \
  -H "content-type: application/json" \
  -H "x-agent-id: bootstrap" \
  -d '{"inviteCode":"opalbip2026","captchaToken":"10000000-aaaa-bbbb-cccc-000000000001"}')
TOKEN=$(echo "$RESP" | jq -r '.accessToken')
AGENT_ID=$(echo "$RESP" | jq -r '.agentId')
# persist AGENT_ID; send it as x-agent-id on all future requests

# 2) get wallet funding address (auto-creates primary solana wallet if needed)
curl -s -X POST "$BASE/api/tools/wallet_deposit_address" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-agent-id: $AGENT_ID" \
  -H "content-type: application/json" \
  -d '{}' | jq '{address, memo, reference}'

# 3) send SOL on-chain, then sync funding credits
curl -s -X POST "$BASE/api/tools/funding_sync" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-agent-id: $AGENT_ID" \
  -H "content-type: application/json" \
  -d '{"maxTx":20}' | jq '{detectedCount, creditedCount, totalCreditedCents}'

# 4) list offerings
curl -s -X POST "$BASE/api/tools/offering_list" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-agent-id: $AGENT_ID" \
  -H "content-type: application/json" \
  -d '{}' | jq '.offerings'

# 5) create intent (example: api_key_purchase)
INTENT=$(curl -s -X POST "$BASE/api/tools/create_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-agent-id: $AGENT_ID" \
  -H "content-type: application/json" \
  -d '{"intentType":"api_key_purchase","provider":"elevenlabs","task":"create API key","budgetUsd":8,"rail":"auto","metadata":{"provider":"elevenlabs","accountEmailMode":"existing","targetProduct":"starter"}}' \
  | jq -r '.intentId')

# 6) approve (if needed) + execute
curl -s -X POST "$BASE/api/tools/approve_intent" -H "authorization: Bearer $TOKEN" -H "x-agent-id: $AGENT_ID" -H "content-type: application/json" -d "{\"intentId\":\"$INTENT\"}"
curl -s -X POST "$BASE/api/tools/execute_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-agent-id: $AGENT_ID" \
  -H "x-idempotency-key: exec-$INTENT-1" \
  -H "content-type: application/json" \
  -d "{\"intentId\":\"$INTENT\"}" | jq

# 7) status + spend
curl -s -X POST "$BASE/api/tools/intent_status" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-agent-id: $AGENT_ID" \
  -H "content-type: application/json" \
  -d "{\"intentId\":\"$INTENT\"}" | jq '{status: .intent.status, fundingStatus, holdAmountCents, settledAmountCents}'
```

## expected outputs

- `status: ok | action_required | failed`
- `runId`, `traceId`
- fulfillment artifacts (code/key refs, receipts)
- `secretRef` for sensitive outputs

## api surface

- `POST /auth/login`
- `POST /api/tools/create_intent`
- `POST /api/tools/offering_list`
- `POST /api/tools/approve_intent`
- `POST /api/tools/execute_intent`
- `POST /api/tools/intent_resume`
- `POST /api/tools/intent_status`
- `POST /api/tools/run_status`
- `POST /api/tools/spend_summary`
- `POST /api/tools/treasury_card_add` (admin + bearer + `x-admin-token`)
- `POST /api/tools/treasury_card_list` (masked metadata only)
- `POST /api/tools/wallet_deposit_address` (returns primary solana funding target)
- `POST /api/tools/funding_sync` (scans Solana inbound txs and auto-credits unprocessed `solana_settled` deposits)
- `POST /api/tools/funding_status` (detected inbound Solana txs + credited/uncredited state)
- `POST /api/tools/funding_mark_settled` (admin-settles solana funding into ledger)

## policy/safety

- provider allowlist enforced
- offering registry and policy caps enforced on `create_intent` for phase-1 offerings
- idempotency required on execute
- spend caps + rate limits should be enforced
- `api_key_purchase` metadata contract requires: `provider`, `accountEmailMode`; supports optional `targetProduct`, `dryRun`
- giftcard intents remain supported as a secondary flow and can reference backend-only treasury card refs via `metadata.cardRef` (or `DEFAULT_TREASURY_CARD_REF`)
- secrets return by reference (`secretRef`), not plaintext by default

---

## shopify dropshipping

agents can run the full shopify dropshipping pipeline through intents — source products from CJ, list on shopify with LLM-generated copy, and auto-fulfill orders.

```bash
# source products from CJ dropshipping
INTENT=$(curl -s -X POST "$BASE/api/tools/create_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-agent-id: $AGENT_ID" \
  -H "content-type: application/json" \
  -d '{"intentType":"shopify_source_products","provider":"cj","task":"find trending phone accessories","budgetUsd":5,"metadata":{"keywords":["phone case","screen protector"],"maxResults":10}}' \
  | jq -r '.intentId')
curl -s -X POST "$BASE/api/tools/approve_intent" -H "authorization: Bearer $TOKEN" -H "x-agent-id: $AGENT_ID" -H "content-type: application/json" -d "{\"intentId\":\"$INTENT\"}"
curl -s -X POST "$BASE/api/tools/execute_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-agent-id: $AGENT_ID" \
  -H "x-idempotency-key: exec-$INTENT-1" \
  -H "content-type: application/json" \
  -d "{\"intentId\":\"$INTENT\"}" | jq

# list, fulfill, or full cycle (all via create_intent + approve + execute)
curl -s -X POST "$BASE/api/tools/create_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-agent-id: $AGENT_ID" \
  -H "content-type: application/json" \
  -d '{"intentType":"shopify_cycle","provider":"shopify","task":"full dropship cycle","budgetUsd":25,"metadata":{"keywords":["trending gadgets"],"maxProducts":5,"marginPct":50}}' | jq
```

### cj_account_bootstrap

provisions CJ Dropshipping credentials per agent. run before shopify_source_products.

```bash
INTENT=$(curl -s -X POST "$BASE/api/tools/create_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-agent-id: $AGENT_ID" \
  -H "content-type: application/json" \
  -d '{"intentType":"cj_account_bootstrap","provider":"cj","task":"create CJ account","budgetUsd":3,"metadata":{}}' | jq -r '.intentId')
curl -s -X POST "$BASE/api/tools/approve_intent" -H "authorization: Bearer $TOKEN" -H "x-agent-id: $AGENT_ID" -H "content-type: application/json" -d "{\"intentId\":\"$INTENT\"}"
curl -s -X POST "$BASE/api/tools/execute_intent" -H "authorization: Bearer $TOKEN" -H "x-agent-id: $AGENT_ID" -H "x-idempotency-key: exec-$INTENT-1" -H "content-type: application/json" -d "{\"intentId\":\"$INTENT\"}"
```

### shopify_store_create

creates a Shopify store and stores creds in agentSecrets. run before shopify_cycle.

```bash
INTENT=$(curl -s -X POST "$BASE/api/tools/create_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-agent-id: $AGENT_ID" \
  -H "content-type: application/json" \
  -d '{"intentType":"shopify_store_create","provider":"shopify","task":"create store","budgetUsd":25,"metadata":{"storeName":"my-dropship","niche":"phone accessories"}}' | jq -r '.intentId')
# approve + execute
```

### shopify intent types

| intentType | provider | what it does |
|---|---|---|
| `cj_account_bootstrap` | `cj` | sign up CJ, store creds per agent |
| `shopify_store_create` | `shopify` | create Shopify store, store creds per agent (metadata: storeName, niche) |
| `shopify_source_products` | `cj` | search CJ, score, filter, store best products (uses agent CJ creds or env) |
| `shopify_list_products` | `shopify` | create shopify listings with LLM copy |
| `shopify_fulfill_orders` | `shopify` | match orders to CJ, place, mark fulfilled |
| `shopify_cycle` | `shopify` | run all stages in sequence |

### metadata contracts

- `shopify_store_create`: `{ storeName?: string, niche?: string }`
- `shopify_source_products`: `{ keywords: string[], category?: string, maxResults?: number, maxPriceUsd?: number }`
- `shopify_list_products`: `{ marginPct?: number, dryRun?: boolean }`
- `shopify_fulfill_orders`: `{ dryRun?: boolean }`
- `shopify_cycle`: `{ keywords?: string[], maxProducts?: number, marginPct?: number, skipSourcing?: boolean, skipListing?: boolean, skipFulfillment?: boolean, dryRun?: boolean }`

---

## dev/debug appendix (optional)

for internal testing only, operators may run bootstrap/wallet endpoints and browser execution with explicit debug inputs.
this is not the default external agent path.
