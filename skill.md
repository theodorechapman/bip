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

# 2) create paid intent
curl -s -X POST "$BASE/api/tools/offering_list" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{}' | jq '.offerings'

# 3) create policy-validated paid intent
INTENT=$(curl -s -X POST "$BASE/api/tools/create_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"intentType":"giftcard_purchase","provider":"bitrefill","task":"buy $10 card and return fulfillment","budgetUsd":10,"rail":"auto"}' \
  | jq -r '.intentId')

# 4) execute
curl -s -X POST "$BASE/api/tools/execute_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-idempotency-key: exec-$INTENT-1" \
  -H "content-type: application/json" \
  -d "{\"intentId\":\"$INTENT\"}" | jq

# 5) intent lifecycle + spend summary
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

## policy/safety

- provider allowlist enforced
- offering registry and policy caps enforced on `create_intent` for phase-1 offerings
- idempotency required on execute
- spend caps + rate limits should be enforced
- secrets return by reference (`secretRef`), not plaintext by default

---

## dev/debug appendix (optional)

for internal testing only, operators may run bootstrap/wallet endpoints and browser execution with explicit debug inputs.
this is not the default external agent path.
