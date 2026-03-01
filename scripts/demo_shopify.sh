#!/usr/bin/env bash
set -euo pipefail

# Shopify dropshipping demo via Convex HTTP API.
# Sources products from CJ, lists them on Shopify (dry-run), checks status.
#
# Requires: SHOPIFY_SHOP_DOMAIN, SHOPIFY_ACCESS_TOKEN, CJ_EMAIL, CJ_PASSWORD
# set in the Convex deployment environment.

BASE="${BASE:-https://wonderful-goose-918.convex.site}"
AGENT_ID="${AGENT_ID:-shopify-demo-$(date +%s)}"
INVITE_CODE="${INVITE_CODE:-opalbip2026}"
CAPTCHA_TOKEN="${CAPTCHA_TOKEN:-10000000-aaaa-bbbb-cccc-000000000001}"
MAX_PRODUCTS="${MAX_PRODUCTS:-5}"
MARGIN="${MARGIN:-50}"
# Keywords as JSON array for the executor
KEYWORDS_JSON="${KEYWORDS_JSON:-[\"phone case\",\"earbuds\"]}"

echo "=== BIP Shopify Dropshipping Demo ==="
echo ""

# ── 1. Login ──
echo "[1/7] login as $AGENT_ID"
TOKEN=$(curl -s -X POST "$BASE/auth/login" \
  -H "content-type: application/json" \
  -H "x-agent-id: $AGENT_ID" \
  -d "{\"inviteCode\":\"$INVITE_CODE\",\"captchaToken\":\"$CAPTCHA_TOKEN\"}" | jq -r '.accessToken')

if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
  echo "login failed" >&2
  exit 1
fi
echo "   logged in"

# ── 2. Get deposit wallet ──
echo "[2/7] get deposit wallet"
DEP=$(curl -s -X POST "$BASE/api/tools/wallet_deposit_address" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{}')
ADDR=$(echo "$DEP" | jq -r '.address')
echo "   deposit address: $ADDR"

# ── 3. Sync funding ──
echo "[3/7] sync funding (safe if empty)"
curl -s -X POST "$BASE/api/tools/funding_sync" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"maxTx":50}' | jq '{creditedCount,alreadyCreditedCount,totalCreditedCents}'

# ── 4. Source products from CJ ──
echo "[4/7] create shopify_source_products intent"
SOURCE_INTENT=$(curl -s -X POST "$BASE/api/tools/create_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d "{\"intentType\":\"shopify_source_products\",\"provider\":\"cj\",\"task\":\"source products from CJ dropshipping\",\"budgetUsd\":5,\"rail\":\"auto\",\"metadata\":{\"keywords\":$KEYWORDS_JSON,\"maxResults\":$MAX_PRODUCTS}}" | jq -r '.intentId')

echo "   intentId: $SOURCE_INTENT"

echo "[5/7] execute source intent"
SOURCE_EXEC=$(curl -s -X POST "$BASE/api/tools/execute_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-idempotency-key: exec-$SOURCE_INTENT-1" \
  -H "content-type: application/json" \
  -d "{\"intentId\":\"$SOURCE_INTENT\"}")

echo "$SOURCE_EXEC" | jq '{status,runId,productsSourced:.output.productsSourced}'

# ── 5. List products on Shopify (dry run) ──
echo "[6/7] create shopify_list_products intent (dry run)"
LIST_INTENT=$(curl -s -X POST "$BASE/api/tools/create_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d "{\"intentType\":\"shopify_list_products\",\"provider\":\"shopify\",\"task\":\"list sourced products on shopify\",\"budgetUsd\":10,\"rail\":\"auto\",\"metadata\":{\"marginPct\":$MARGIN,\"dryRun\":true}}" | jq -r '.intentId')

echo "   intentId: $LIST_INTENT"

echo "[7/7] execute list intent (dry run)"
LIST_EXEC=$(curl -s -X POST "$BASE/api/tools/execute_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-idempotency-key: exec-$LIST_INTENT-1" \
  -H "content-type: application/json" \
  -d "{\"intentId\":\"$LIST_INTENT\"}")

echo "$LIST_EXEC" | jq '{status,runId,productsListed:.output.productsListed}'

# ── Summary ──
echo ""
echo "=== Demo Summary ==="
echo "agentId=$AGENT_ID"
echo "sourceIntentId=$SOURCE_INTENT"
echo "listIntentId=$LIST_INTENT"
echo ""
echo "to run a full cycle (non-dry-run), set KEYWORDS and remove dryRun from the list intent"
echo "to fulfill orders: create a shopify_fulfill_orders intent"
