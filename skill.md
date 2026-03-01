---
name: bip
version: 1.1.0
description: "Hosted agent commerce runtime: authenticated paid intents in, fulfillment artifacts out."
tags: [agents, commerce, payments, x402, gift-cards, api-keys, automation]
metadata:
  openclaw:
    emoji: "🧠"
  homepage: https://enduring-rooster-593.convex.site/skill.md
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
secondary example: `giftcard_purchase`

base url:

```bash
BASE="https://enduring-rooster-593.convex.site"
```

## production flow (default)

```bash
# 1) login
TOKEN=$(curl -s -X POST "$BASE/auth/login" \
  -H "content-type: application/json" \
  -H "x-agent-id: agent-$(date +%s)" \
  -d '{"inviteCode":"opalbip2026","captchaToken":"10000000-aaaa-bbbb-cccc-000000000001"}' \
  | jq -r '.accessToken')

# 2) get wallet funding address (auto-creates primary solana wallet if needed)
curl -s -X POST "$BASE/api/tools/wallet_deposit_address" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{}' | jq '{address, memo, reference}'

# 3) send SOL on-chain to the returned address, then sync funding credits
curl -s -X POST "$BASE/api/tools/funding_sync" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"maxTx":20}' | jq '{detectedCount, creditedCount, totalCreditedCents}'

# 4) create paid intent
curl -s -X POST "$BASE/api/tools/offering_list" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{}' | jq '.offerings'

# 5) create policy-validated paid intent (primary MVP: api_key_purchase)
INTENT=$(curl -s -X POST "$BASE/api/tools/create_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"intentType":"api_key_purchase","provider":"elevenlabs","task":"create API key and return proof","budgetUsd":8,"rail":"auto","metadata":{"provider":"elevenlabs","accountEmailMode":"existing","targetProduct":"starter"}}' \
  | jq -r '.intentId')

# 6) execute
curl -s -X POST "$BASE/api/tools/execute_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-idempotency-key: exec-$INTENT-1" \
  -H "content-type: application/json" \
  -d "{\"intentId\":\"$INTENT\"}" | jq

# 7) intent lifecycle + spend summary
curl -s -X POST "$BASE/api/tools/intent_status" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d "{\"intentId\":\"$INTENT\"}" | jq '{status: .intent.status, fundingStatus, holdAmountCents, settledAmountCents, releasedAmountCents}'

curl -s -X POST "$BASE/api/tools/spend_summary" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{}' | jq
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

## dev/debug appendix (optional)

for internal testing only, operators may run bootstrap/wallet endpoints and browser execution with explicit debug inputs.
this is not the default external agent path.
