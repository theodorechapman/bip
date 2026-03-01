#!/usr/bin/env bash
set -euo pipefail

# ── Integration test: email verification after agentmail signup ──
# Tests the full flow: login → fund → create_intent → execute_intent → check email_verification_attempted event
#
# Usage:
#   ./scripts/test_email_verify.sh
#
# Override defaults:
#   BASE="https://your-instance.convex.site" INVITE_CODE="yourcode" ./scripts/test_email_verify.sh

BASE="${BASE:-https://wonderful-goose-918.convex.site}"
AGENT_ID="${AGENT_ID:-test-emailverify-$(date +%s)}"
INVITE_CODE="${INVITE_CODE:-opalbip2026}"
CAPTCHA_TOKEN="${CAPTCHA_TOKEN:-10000000-aaaa-bbbb-cccc-000000000001}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC}: $1"; }
fail() { echo -e "${RED}FAIL${NC}: $1"; exit 1; }
info() { echo -e "${YELLOW}[$1]${NC} $2"; }

# ── Step 1: Login ──
info "1/6" "logging in as $AGENT_ID"
LOGIN=$(curl -sf -X POST "$BASE/auth/login" \
  -H "content-type: application/json" \
  -H "x-agent-id: $AGENT_ID" \
  -d "{\"inviteCode\":\"$INVITE_CODE\",\"captchaToken\":\"$CAPTCHA_TOKEN\"}")

TOKEN=$(echo "$LOGIN" | jq -r '.accessToken // empty')
if [[ -z "$TOKEN" ]]; then
  echo "$LOGIN" | jq .
  fail "login failed — no accessToken returned"
fi
pass "logged in (token=$(echo $TOKEN | cut -c1-12)...)"

# ── Step 2: Get deposit wallet ──
info "2/6" "getting deposit wallet"
WALLET=$(curl -sf -X POST "$BASE/api/tools/wallet_deposit_address" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{}')
ADDR=$(echo "$WALLET" | jq -r '.address // empty')
if [[ -z "$ADDR" ]]; then
  echo "$WALLET" | jq .
  fail "wallet_deposit_address failed"
fi
pass "wallet address: $ADDR"

# ── Step 3: Sync funding ──
info "3/6" "syncing funding (will proceed even if 0 funded)"
SYNC=$(curl -sf -X POST "$BASE/api/tools/funding_sync" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"maxTx":50}')
echo "$SYNC" | jq '{creditedCount,totalCreditedCents}'

# Check balance
SUMMARY=$(curl -sf -X POST "$BASE/api/tools/spend_summary" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{}')
FUNDED=$(echo "$SUMMARY" | jq -r '.totalFunded // 0')
info "---" "total funded: ${FUNDED} cents"

if [[ "$FUNDED" -lt 500 ]]; then
  echo -e "${YELLOW}WARNING${NC}: account has <\$5 funded. create_intent may fail on policy."
  echo "fund the wallet at $ADDR with some SOL first, then re-run."
  echo "continuing anyway to see what happens..."
fi

# ── Step 4: Create intent (api_key_purchase + agentmail) ──
info "4/6" "creating api_key_purchase intent with accountEmailMode=agentmail"
CREATE=$(curl -sf -X POST "$BASE/api/tools/create_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "intentType": "api_key_purchase",
    "provider": "openrouter",
    "task": "create OpenRouter API key and return proof",
    "budgetUsd": 5,
    "rail": "auto",
    "metadata": {
      "provider": "openrouter",
      "accountEmailMode": "agentmail",
      "targetProduct": "starter"
    }
  }')

INTENT_ID=$(echo "$CREATE" | jq -r '.intentId // empty')
if [[ -z "$INTENT_ID" ]]; then
  echo "$CREATE" | jq .
  fail "create_intent failed — no intentId"
fi
pass "intent created: $INTENT_ID"

# ── Step 5: Execute intent ──
info "5/6" "executing intent (this takes a while — browser-use signup + email poll)..."
IDEMPOTENCY="exec-emailverify-$INTENT_ID-1"
EXEC=$(curl -sf -X POST "$BASE/api/tools/execute_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-idempotency-key: $IDEMPOTENCY" \
  -H "content-type: application/json" \
  -d "{\"intentId\":\"$INTENT_ID\"}" \
  --max-time 600)

EXEC_STATUS=$(echo "$EXEC" | jq -r '.status // empty')
echo "$EXEC" | jq '{status,runId,traceId,handoffUrl,reason,nextAction}'

if [[ "$EXEC_STATUS" == "ok" ]]; then
  pass "execute_intent returned ok"
elif [[ "$EXEC_STATUS" == "action_required" ]]; then
  info "---" "execute returned action_required (may still have attempted verification)"
else
  echo "$EXEC" | jq .
  fail "execute_intent returned unexpected status: $EXEC_STATUS"
fi

# ── Step 6: Check for email_verification_attempted event ──
info "6/6" "checking intent_status for email_verification_attempted event"
STATUS=$(curl -sf -X POST "$BASE/api/tools/intent_status" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d "{\"intentId\":\"$INTENT_ID\"}")

# Find the email_verification_attempted event
VERIFY_EVENT=$(echo "$STATUS" | jq '[.events[] | select(.eventType == "email_verification_attempted")] | first // empty')

if [[ -z "$VERIFY_EVENT" || "$VERIFY_EVENT" == "null" ]]; then
  echo -e "\navailable events:"
  echo "$STATUS" | jq '[.events[].eventType]'
  fail "no email_verification_attempted event found in intent events"
fi

# Parse the payload
PAYLOAD=$(echo "$VERIFY_EVENT" | jq -r '.payloadJson // empty')
if [[ -n "$PAYLOAD" ]]; then
  echo -e "\nemail_verification_attempted payload:"
  echo "$PAYLOAD" | jq .

  EMAIL_FOUND=$(echo "$PAYLOAD" | jq -r '.emailFound // false')
  LINK_FOUND=$(echo "$PAYLOAD" | jq -r '.linkFound // false')
  VERIFY_METHOD=$(echo "$PAYLOAD" | jq -r '.verifyMethod // "none"')
  VERIFY_OK=$(echo "$PAYLOAD" | jq -r '.verifyOk // false')

  pass "event recorded with emailFound=$EMAIL_FOUND linkFound=$LINK_FOUND method=$VERIFY_METHOD ok=$VERIFY_OK"
else
  pass "email_verification_attempted event exists (no payload to parse)"
fi

echo ""
echo "=============================="
echo -e "${GREEN}integration test complete${NC}"
echo "agentId=$AGENT_ID"
echo "intentId=$INTENT_ID"
echo "=============================="
