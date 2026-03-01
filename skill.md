---
name: bip
version: 1.0.0
description: "agent commerce runtime: authenticated intents, wallet/email bootstrap, browser+rail execution, and fulfillment artifacts (codes/keys/proofs)."
tags: [agents, commerce, payments, gift-cards, api-keys, browser-use, crypto, x402]
metadata:
  openclaw:
    emoji: "🧠"
  homepage: https://bip.opalbot.gg/skill.md
---

# bip skill.md

bip is a hosted runtime for autonomous agents to request paid actions (cards, credits, account setup), execute safely, and return verifiable outputs.

base url:

```bash
BASE="https://bip.opalbot.gg"
```

---

## core use cases

- buy gift cards (bitrefill flow)
- acquire API access/credits (e.g. provider onboarding + key retrieval flow)
- bootstrap an agent identity (wallet + inbox + auth)
- run browser workflows with payment/checkout handoffs
- return fulfillment artifacts (code/key refs, receipts, traces)

---

## auth model

bip requires authenticated sessions.

```bash
AGENT_ID="agent-$(date +%s)"

TOKEN=$(curl -s -X POST "$BASE/auth/login" \
  -H "content-type: application/json" \
  -H "x-agent-id: $AGENT_ID" \
  -d '{
    "inviteCode":"opalbip2026",
    "captchaToken":"10000000-aaaa-bbbb-cccc-000000000001"
  }' | jq -r '.accessToken')
```

---

## quickstart flow (agent bootstrap -> intent -> execute)

```bash
# 1) bootstrap identity (wallet + inbox best effort)
curl -s -X POST "$BASE/api/tools/agent_bootstrap" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"chain":"solana","emailPrefix":"bip.agent"}' | jq

# 2) create intent
INTENT=$(curl -s -X POST "$BASE/api/tools/create_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "intentType":"api_key_purchase",
    "provider":"openrouter",
    "task":"create account, add credits, retrieve API key",
    "budgetUsd":8,
    "rail":"auto",
    "metadata":{"mode":"browser_checkout"}
  }' | jq -r '.intentId')

# 3) execute (idempotency required)
curl -s -X POST "$BASE/api/tools/execute_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-idempotency-key: run-$INTENT-1" \
  -H "x-browser-use-api-key: <BU_KEY>" \
  -H "content-type: application/json" \
  -d "{\"intentId\":\"$INTENT\"}" | jq
```

---

## key endpoints

- `POST /auth/login`
- `POST /api/tools/agent_bootstrap`
- `POST /api/tools/create_intent`
- `POST /api/tools/approve_intent`
- `POST /api/tools/execute_intent`
- `POST /api/tools/intent_resume`
- `POST /api/tools/intent_status`
- `POST /api/tools/run_status`
- `POST /api/tools/wallet_generate`
- `POST /api/tools/wallet_balance`
- `POST /api/tools/wallet_deposit`
- `POST /api/tools/wallet_transfer`
- `POST /api/tools/secrets_get`

---

## intent patterns

### 1) gift card purchase

```json
{
  "intentType": "giftcard_purchase",
  "provider": "bitrefill",
  "task": "buy $25 amazon us card to email",
  "budgetUsd": 25,
  "rail": "bitrefill"
}
```

### 2) api key purchase

```json
{
  "intentType": "api_key_purchase",
  "provider": "openrouter",
  "task": "create account + buy starter credits + retrieve key",
  "budgetUsd": 10,
  "rail": "auto"
}
```

### 3) crypto checkout capture/autopay

```json
{
  "intentType": "bitrefill_crypto_checkout",
  "provider": "bitrefill",
  "task": "reach SOL invoice page and return exact payment address + amount",
  "budgetUsd": 10,
  "rail": "auto"
}
```

---

## responses you should handle

- `status: ok` → completed
- `status: action_required` → human step needed (login/captcha/payment confirmation)
- `status: failed` → execution failed (check `error` + events)

execute responses may include:
- `traceId`
- `runId`
- `taskId`
- `handoffUrl` (if available)
- `credential.secretRef` (for key/card secret storage)

---

## safety and policy expectations

- provider allowlist enforced
- idempotency required for execute
- spend caps should be set per intent/day
- secrets should be returned by reference (`secretRef`) and audited
- keep kill switch available for paid execution

---

## operator notes

for launch/testing with autonomous agents:
- use scoped API keys/session tokens per agent
- keep budget constraints explicit in every intent
- prefer short, deterministic tasks over giant prompts
- use `intent_status` + `run_status` for state reconciliation
