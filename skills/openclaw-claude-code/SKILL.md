---
name: bip
version: 2.0.0
description: "Agent commerce runtime. Authenticate, fund a wallet, buy gift cards, purchase API keys, bootstrap accounts — all via HTTP. No CLI install needed."
tags: [agents, commerce, payments, x402, gift-cards, api-keys, automation]
---

# bip — agent commerce runtime

bip lets your agent authenticate, hold funds, and execute paid intents (gift cards, API keys, account bootstraps) via HTTP calls. no SDK, no CLI install — just curl.

**base url:** `https://enduring-rooster-593.convex.site`

---

## step 1: authenticate

```bash
TOKEN=$(curl -s -X POST "$BIP_BASE/auth/login" \
  -H "content-type: application/json" \
  -H "x-agent-id: agent-$(date +%s)" \
  -d '{"inviteCode":"opalbip2026","captchaToken":"10000000-aaaa-bbbb-cccc-000000000001"}' \
  | jq -r '.accessToken')
```

response:
```json
{
  "accessToken": "at_...",
  "expiresAt": 1772444649,
  "maxApiCalls": 100,
  "remainingApiCalls": 100
}
```

save the `accessToken`. all subsequent calls need `Authorization: Bearer $TOKEN`.

---

## step 2: check available offerings

```bash
curl -s -X POST "$BIP_BASE/api/tools/offering_list" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{}' | jq '.offerings'
```

current offerings:
| offering | intentType | provider | max per intent |
|---|---|---|---|
| `giftcard.bitrefill.buy` | `giftcard_purchase` | bitrefill | $250 |
| `apikey.provider.buy` | `api_key_purchase` | openrouter | $50 |
| `account.bootstrap` | `account_bootstrap` | bitrefill, x, shopify | $25 |

---

## step 3: get wallet deposit address

```bash
curl -s -X POST "$BIP_BASE/api/tools/wallet_deposit_address" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{}' | jq .
```

response:
```json
{
  "ok": true,
  "chain": "solana",
  "address": "97QAuw7xeKRd6ZQkqWvRoLQbSzK4uFYtXkrhBLhJPgts",
  "memo": "fund_...",
  "reference": "fund_..."
}
```

send SOL to the address. include the memo for faster matching.

---

## step 4: create an intent

```bash
# gift card
curl -s -X POST "$BIP_BASE/api/tools/create_intent" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "intentType": "giftcard_purchase",
    "provider": "bitrefill",
    "task": "buy $5 Amazon gift card",
    "budgetUsd": 5,
    "rail": "auto"
  }' | jq .

# API key
curl -s -X POST "$BIP_BASE/api/tools/create_intent" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "intentType": "api_key_purchase",
    "provider": "openrouter",
    "task": "purchase OpenRouter API credits",
    "budgetUsd": 10,
    "rail": "auto"
  }' | jq .
```

response:
```json
{
  "approvalRequired": false,
  "intentId": "pi_...",
  "status": "approved"
}
```

save the `intentId`.

---

## step 5: sync funding (after sending SOL)

```bash
curl -s -X POST "$BIP_BASE/api/tools/funding_sync" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{}' | jq .
```

call this after you've sent SOL to the deposit address. it syncs the on-chain balance with your bip account.

---

## step 6: execute the intent

```bash
curl -s -X POST "$BIP_BASE/api/tools/execute_intent" \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-idempotency-key: exec-$INTENT_ID-1" \
  -H "content-type: application/json" \
  -d "{\"intentId\":\"$INTENT_ID\"}" | jq .
```

this triggers the actual purchase. bip handles browser automation, checkout, and fulfillment.

if status comes back `action_required`, call `intent_resume` after the required action is complete.

---

## step 7: check status + results

```bash
# intent status (includes fulfillment artifacts)
curl -s -X POST "$BIP_BASE/api/tools/intent_status" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d "{\"intentId\":\"$INTENT_ID\"}" | jq .

# overall spend summary
curl -s -X POST "$BIP_BASE/api/tools/spend_summary" \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{}' | jq .
```

---

## full endpoint reference

| method | endpoint | description |
|---|---|---|
| POST | `/auth/login` | authenticate, get access token |
| POST | `/api/tools/offering_list` | list available offerings + policies |
| POST | `/api/tools/wallet_deposit_address` | get SOL deposit address |
| POST | `/api/tools/funding_sync` | sync on-chain funding to account |
| POST | `/api/tools/create_intent` | create a purchase intent |
| POST | `/api/tools/approve_intent` | manually approve an intent (if required) |
| POST | `/api/tools/execute_intent` | execute an approved + funded intent |
| POST | `/api/tools/intent_resume` | resume after action_required |
| POST | `/api/tools/intent_status` | check intent status + artifacts |
| POST | `/api/tools/run_status` | check execution run status |
| POST | `/api/tools/spend_summary` | ledger summary of all spending |

---

## common flows

### buy a gift card
```
auth/login → wallet_deposit_address → [fund wallet] → funding_sync → create_intent(giftcard_purchase) → execute_intent → intent_status
```

### get an API key
```
auth/login → wallet_deposit_address → [fund wallet] → funding_sync → create_intent(api_key_purchase) → execute_intent → intent_status
```

### bootstrap an account
```
auth/login → create_intent(account_bootstrap) → execute_intent → intent_status
```

---

## error handling

- `"error": "Missing bearer token"` — token expired or not included. re-authenticate.
- `"fundingStatus": "not_funded"` — wallet not funded. send SOL and call funding_sync.
- `"status": "action_required"` — human action needed (e.g. captcha). check intent_status for instructions, then call intent_resume.
- idempotency: always include `x-idempotency-key` on execute_intent to prevent double-charges.

---

## important notes

- all money is real. intents spend actual funds.
- wallet is Solana-based. send SOL to the deposit address.
- gift cards are purchased via Bitrefill. fulfillment artifacts include codes/refs.
- API keys are provisioned via browser automation (OpenRouter signup flow).
- policy caps are enforced server-side. you cannot exceed max budget per intent or per day.
- access tokens expire in 24h with a 100 API call limit.
