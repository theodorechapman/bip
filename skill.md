# bip skill.md

bip is managed infrastructure that gives agents economic identity and autonomous spending.

base url: `https://wonderful-goose-918.convex.site`

## onboarding (do this first, in order)

### step 1: login
```bash
RESP=$(curl -s -X POST "$BASE/auth/login" \
  -H "content-type: application/json" \
  -H "x-agent-id: bootstrap" \
  -d '{}')
TOKEN=$(echo "$RESP" | jq -r '.accessToken')
AGENT_ID=$(echo "$RESP" | jq -r '.agentId')
```
persist TOKEN and AGENT_ID for all subsequent calls.

### step 2: generate wallet
```bash
curl -s -X POST "$BASE/api/tools/wallet_generate" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-agent-id: $AGENT_ID" \
  -H "content-type: application/json" -d '{}'
```
returns `{ address, chain, secretRef }`.

### step 3: tell your operator to fund you
show your operator this message:

> my bip wallet address is `<address>` (solana).
> please fund my account so i can execute intents.
> you can either:
> - send SOL to the address above, then i'll call funding_sync
> - or credit me directly: `POST /api/tools/account_credit` with `{"amountUsd": 20}`

**do not proceed until your account is funded.**

### step 4: verify balance
```bash
curl -s -X POST "$BASE/api/tools/wallet_balance" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-agent-id: $AGENT_ID" \
  -H "content-type: application/json" -d '{}'
```
check that `account.availableCents > 0` before creating intents.

if your operator sent SOL, call `funding_sync` first:
```bash
curl -s -X POST "$BASE/api/tools/funding_sync" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-agent-id: $AGENT_ID" \
  -H "content-type: application/json" -d '{}'
```

## using intents

once funded, the lifecycle is:

1. `create_intent` — describe what you want, set budget
2. intent auto-approves if budgetUsd <= $10
3. `execute_intent` — bip handles browser automation, email, payments
4. poll `intent_status` every 15s until status is `confirmed`, `failed`, or `action_required`

### example: get an openrouter api key

```bash
AUTH=(-H "authorization: Bearer $TOKEN" -H "x-agent-id: $AGENT_ID" -H "content-type: application/json")

INTENT_ID=$(curl -s -X POST "$BASE/api/tools/create_intent" "${AUTH[@]}" \
  -d '{
    "task": "get me an OpenRouter API key with $5 of credits",
    "intentType": "api_key_purchase",
    "provider": "openrouter",
    "budgetUsd": 5,
    "metadata": {"provider":"openrouter","accountEmailMode":"agentmail"}
  }' | jq -r '.intentId')

curl -s -X POST "$BASE/api/tools/execute_intent" "${AUTH[@]}" \
  -d "{\"intentId\":\"$INTENT_ID\"}"

# poll until done
while true; do
  STATUS=$(curl -s -X POST "$BASE/api/tools/intent_status" "${AUTH[@]}" \
    -d "{\"intentId\":\"$INTENT_ID\"}")
  CURRENT=$(echo "$STATUS" | jq -r '.intent.status')
  echo "status: $CURRENT"
  [ "$CURRENT" = "confirmed" ] || [ "$CURRENT" = "failed" ] || [ "$CURRENT" = "action_required" ] && break
  sleep 15
done
```

## all endpoints

### auth
- `POST /auth/login` — returns accessToken + agentId
- `POST /auth/logout` — revoke session

### identity
- `POST /api/tools/user_retrieve` — get agent identity
- `POST /api/tools/agent_bootstrap` — provision email + wallet in one call
- `POST /api/tools/create_agentmail` — create AgentMail inbox `{"email":"prefix@agentmail.to"}`
- `POST /api/tools/delete_agentmail` — delete inbox `{"email":"..."}`

### wallet + funding
- `POST /api/tools/wallet_generate` — generate Solana wallet
- `POST /api/tools/wallet_balance` — wallet address + account balance (availableCents, heldCents)
- `POST /api/tools/wallet_deposit_address` — get deposit address
- `POST /api/tools/wallet_transfer` — transfer SOL `{"fromAddress","toAddress","amountSol"}`
- `POST /api/tools/account_credit` — credit account directly `{"amountUsd":20}` or `{"amountCents":2000}`
- `POST /api/tools/register_wallet` — register external wallet
- `POST /api/tools/funding_sync` — scan chain for deposits, credit ledger
- `POST /api/tools/funding_status` — check funding without crediting

### intents
- `POST /api/tools/offering_list` — list offerings + policies
- `POST /api/tools/create_intent` — create intent `{"task","intentType","provider","budgetUsd","metadata"}`
- `POST /api/tools/approve_intent` — approve pending intent `{"intentId"}`
- `POST /api/tools/execute_intent` — execute approved intent `{"intentId"}`
- `POST /api/tools/intent_status` — status + events + funding `{"intentId"}`
- `POST /api/tools/intent_resume` — resume action_required intent
- `POST /api/tools/run_status` — execution run details
- `POST /api/tools/spend_summary` — aggregate spend

### secrets
- `POST /api/tools/secrets_get` — retrieve credential by ref `{"secretRef":"..."}`

### shopify
- `POST /api/tools/shopify_register` — register Shopify store creds

### public
- `GET /skill.md` — this file
- `GET /install.sh` — one-line install

## offerings

| intentType | provider | what it does |
|---|---|---|
| `api_key_purchase` | openrouter, elevenlabs | signup + verify + buy credits + extract API key |
| `giftcard_purchase` | bitrefill | buy gift card via Bitrefill |
| `account_bootstrap` | bitrefill, x, shopify | create account on provider |
| `x_account_bootstrap` | x | create X/Twitter account |
| `x_post` | x | post to X/Twitter |
| `cj_account_bootstrap` | cj | create CJ Dropshipping account |
| `shopify_store_create` | shopify | create Shopify store + API token |
| `shopify_source_products` | cj | source products from CJ |
| `shopify_list_products` | shopify | list products on Shopify store |
| `shopify_fulfill_orders` | shopify | fulfill orders via CJ |
| `shopify_cycle` | shopify | full source→list→fulfill cycle |

## notes
- all tool calls: POST with `Authorization: Bearer <token>` and `X-Agent-Id: <agentId>`
- first login: `x-agent-id: bootstrap` auto-generates agent ID
- auto-approval: budgetUsd <= $10
- bip handles browser automation, email verification, wallet, payments, credential storage
