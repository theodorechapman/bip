# bip one-take demo (3 minutes)

## headline
"agents fund once, run paid intents, and get verifiable artifacts back."

## base
- API: `https://enduring-rooster-593.convex.site`
- Skill: `https://enduring-rooster-593.convex.site/skill.md`

## script
1) login + wallet
2) send sol
3) funding_sync
4) create api_key_purchase intent
5) execute intent
6) present `runId`, `traceId`, `credential.secretRef` OR `action_required + handoffUrl`

## live commands
```bash
BASE="https://enduring-rooster-593.convex.site"
AGENT_ID="demo-$(date +%s)"

TOKEN=$(curl -s -X POST "$BASE/auth/login" \
  -H "content-type: application/json" \
  -H "x-agent-id: $AGENT_ID" \
  -d '{"inviteCode":"opalbip2026","captchaToken":"10000000-aaaa-bbbb-cccc-000000000001"}' | jq -r '.accessToken')

curl -s -X POST "$BASE/api/tools/wallet_deposit_address" \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" -d '{}' | jq

# after sending SOL to returned address:
curl -s -X POST "$BASE/api/tools/funding_sync" \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" -d '{"maxTx":50}' | jq

INTENT=$(curl -s -X POST "$BASE/api/tools/create_intent" \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"intentType":"api_key_purchase","provider":"openrouter","task":"create API key and return proof","budgetUsd":5,"rail":"auto","metadata":{"provider":"openrouter","accountEmailMode":"agentmail","targetProduct":"starter"}}' | jq -r '.intentId')

curl -s -X POST "$BASE/api/tools/execute_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-idempotency-key: exec-$INTENT-1" \
  -H "content-type: application/json" \
  -d "{\"intentId\":\"$INTENT\"}" | jq
```

## Q&A bullets
- login/captcha gates are captured as `action_required` (not silent failures)
- secrets are returned by reference (`secretRef`), not plaintext
- funding is syncable via `funding_sync` (idempotent tx crediting)
