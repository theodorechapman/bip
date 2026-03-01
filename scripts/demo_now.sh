#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-https://wonderful-goose-918.convex.site}"
AGENT_ID="${AGENT_ID:-demo-$(date +%s)}"
INVITE_CODE="${INVITE_CODE:-opalbip2026}"
CAPTCHA_TOKEN="${CAPTCHA_TOKEN:-10000000-aaaa-bbbb-cccc-000000000001}"

echo "[1/6] login as $AGENT_ID"
TOKEN=$(curl -s -X POST "$BASE/auth/login" \
  -H "content-type: application/json" \
  -H "x-agent-id: $AGENT_ID" \
  -d "{\"inviteCode\":\"$INVITE_CODE\",\"captchaToken\":\"$CAPTCHA_TOKEN\"}" | jq -r '.accessToken')

if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
  echo "login failed" >&2
  exit 1
fi

echo "[2/6] get deposit wallet"
DEP=$(curl -s -X POST "$BASE/api/tools/wallet_deposit_address" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{}')
ADDR=$(echo "$DEP" | jq -r '.address')
REF=$(echo "$DEP" | jq -r '.reference')

echo "deposit address: $ADDR"
echo "reference: $REF"

echo "[3/6] sync funding (safe if empty)"
curl -s -X POST "$BASE/api/tools/funding_sync" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"maxTx":50}' | jq '{creditedCount,alreadyCreditedCount,totalCreditedCents}'

echo "[4/6] create api_key_purchase intent (openrouter)"
INTENT=$(curl -s -X POST "$BASE/api/tools/create_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"intentType":"api_key_purchase","provider":"openrouter","task":"create OpenRouter API key and return proof","budgetUsd":5,"rail":"auto","metadata":{"provider":"openrouter","accountEmailMode":"agentmail","targetProduct":"starter"}}' | jq -r '.intentId')

echo "intentId: $INTENT"

echo "[5/6] execute"
EXEC=$(curl -s -X POST "$BASE/api/tools/execute_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-idempotency-key: exec-$INTENT-1" \
  -H "content-type: application/json" \
  -d "{\"intentId\":\"$INTENT\"}")

echo "$EXEC" | jq '{status,runId,traceId,handoffUrl,reason,nextAction,credential,proofRef}'

echo "[6/6] intent_status"
curl -s -X POST "$BASE/api/tools/intent_status" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d "{\"intentId\":\"$INTENT\"}" | jq '{status:.intent.status,fundingStatus,holdAmountCents,settledAmountCents,releasedAmountCents}'

echo "\n✅ demo packet"
echo "agentId=$AGENT_ID"
echo "intentId=$INTENT"
