#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-https://wonderful-goose-918.convex.site}"
AGENT_ID="${AGENT_ID:-demo-$(date +%s)}"
INVITE_CODE="${INVITE_CODE:-opalbip2026}"
CAPTCHA_TOKEN="${CAPTCHA_TOKEN:-10000000-aaaa-bbbb-cccc-000000000001}"

echo "[1/7] login as $AGENT_ID"
LOGIN_RESP=$(curl -s -X POST "$BASE/auth/login" \
  -H "content-type: application/json" \
  -H "x-agent-id: $AGENT_ID" \
  -d "{\"inviteCode\":\"$INVITE_CODE\",\"captchaToken\":\"$CAPTCHA_TOKEN\"}")

TOKEN=$(echo "$LOGIN_RESP" | jq -r '.accessToken')
RESOLVED_AGENT=$(echo "$LOGIN_RESP" | jq -r '.agentId')

if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
  echo "login failed:" >&2
  echo "$LOGIN_RESP" | jq . >&2
  exit 1
fi
echo "  token: ${TOKEN:0:12}..."
echo "  agentId: $RESOLVED_AGENT"

AUTH=(-H "authorization: Bearer $TOKEN" -H "x-agent-id: $RESOLVED_AGENT" -H "content-type: application/json")

echo "[2/7] get deposit wallet"
DEP=$(curl -s -X POST "$BASE/api/tools/wallet_deposit_address" "${AUTH[@]}" -d '{}')
ADDR=$(echo "$DEP" | jq -r '.address')
echo "  deposit address: $ADDR"

echo "[3/7] sync funding"
SYNC=$(curl -s -X POST "$BASE/api/tools/funding_sync" "${AUTH[@]}" -d '{"maxTx":50}')
echo "$SYNC" | jq '{creditedCount,alreadyCreditedCount,totalCreditedCents}'

echo "[4/7] create api_key_purchase intent (openrouter, \$5)"
INTENT=$(curl -s -X POST "$BASE/api/tools/create_intent" "${AUTH[@]}" \
  -d '{"intentType":"api_key_purchase","provider":"openrouter","task":"create OpenRouter API key and return proof","budgetUsd":5,"rail":"auto","metadata":{"provider":"openrouter","accountEmailMode":"agentmail","targetProduct":"starter"}}')

INTENT_ID=$(echo "$INTENT" | jq -r '.intentId')
INTENT_STATUS=$(echo "$INTENT" | jq -r '.status')

if [[ -z "$INTENT_ID" || "$INTENT_ID" == "null" ]]; then
  echo "create_intent failed:" >&2
  echo "$INTENT" | jq . >&2
  exit 1
fi
echo "  intentId: $INTENT_ID"
echo "  status: $INTENT_STATUS"

if [[ "$INTENT_STATUS" == "needs_approval" ]]; then
  echo "[4b/7] approving intent"
  curl -s -X POST "$BASE/api/tools/approve_intent" "${AUTH[@]}" \
    -d "{\"intentId\":\"$INTENT_ID\"}" | jq '{ok,status}'
fi

echo "[5/7] execute intent"
EXEC=$(curl -s -X POST "$BASE/api/tools/execute_intent" "${AUTH[@]}" \
  -H "x-idempotency-key: exec-$INTENT_ID-1" \
  -d "{\"intentId\":\"$INTENT_ID\"}")

echo "$EXEC" | jq '{status,runId,traceId,handoffUrl,reason,nextAction,credential,proofRef}'

RUN_ID=$(echo "$EXEC" | jq -r '.runId // empty')

echo "[6/7] poll intent_status (waiting for execution...)"
for i in $(seq 1 12); do
  sleep 10
  STATUS=$(curl -s -X POST "$BASE/api/tools/intent_status" "${AUTH[@]}" \
    -d "{\"intentId\":\"$INTENT_ID\"}")
  CURRENT=$(echo "$STATUS" | jq -r '.intent.status')
  echo "  [$i] status=$CURRENT"
  if [[ "$CURRENT" == "confirmed" || "$CURRENT" == "failed" || "$CURRENT" == "action_required" ]]; then
    echo "$STATUS" | jq '{status:.intent.status,fundingStatus,holdAmountCents,settledAmountCents,releasedAmountCents}'
    break
  fi
done

echo "[7/7] final run_status"
if [[ -n "$RUN_ID" ]]; then
  curl -s -X POST "$BASE/api/tools/run_status" "${AUTH[@]}" \
    -d "{\"runId\":\"$RUN_ID\"}" | jq '{status,outputJson,error}'
fi

echo ""
echo "demo complete"
echo "  agentId=$RESOLVED_AGENT"
echo "  intentId=$INTENT_ID"
echo "  runId=$RUN_ID"
