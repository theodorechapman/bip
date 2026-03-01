---
name: bip-agent-gateway
version: 0.2.0
description: "universal agent endpoint: create/approve/execute intents, run browser-use tasks, and return traceable results over plain http."
tags: [agents, payments, browser-use, api, tracing, laminar, hud]
metadata:
  openclaw:
    emoji: "🧠"
  homepage: https://github.com/theodorechapman/bip
---

# bip skill.md (agent onboarding)

use this when you want any agent (claude code, codex, curl bot, etc.) to call one endpoint and execute web/payment tasks with run traces.

## live endpoint

```bash
BASE="https://standing-aardvark-407.convex.site"
```

## what this gives you

- login/session token for agent calls
- intent lifecycle: drafted/approved/submitted/confirmed/failed
- browser-use backed execution
- run artifacts + status APIs
- trace id on execute responses (`traceId`) for observability routing

## fastest onboarding (copy/paste)

```bash
BASE="https://standing-aardvark-407.convex.site"
BU_KEY="<your-browser-use-key>"
AGENT_ID="agent-$(date +%s)"

# 1) login
TOKEN=$(curl -s -X POST "$BASE/auth/login" \
  -H 'content-type: application/json' \
  -H "x-agent-id: $AGENT_ID" \
  -d '{}' | jq -r '.accessToken')

# 2) create intent
INTENT=$(curl -s -X POST "$BASE/api/tools/create_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"task":"open example.com and return title","budgetUsd":2,"rail":"auto"}' | jq -r '.intentId')

# 3) execute intent
EXEC=$(curl -s -X POST "$BASE/api/tools/execute_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-browser-use-api-key: $BU_KEY" \
  -H 'content-type: application/json' \
  -d "{\"intentId\":\"$INTENT\"}")

echo "$EXEC" | jq
RUN_ID=$(echo "$EXEC" | jq -r '.runId')

# 4) run status
curl -s -X POST "$BASE/api/tools/run_status" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"runId\":\"$RUN_ID\"}" | jq
```

## api contract (minimal)

- `POST /auth/login` (header: `X-Agent-Id`)
- `POST /api/tools/create_intent`
- `POST /api/tools/approve_intent` (if intent needs approval)
- `POST /api/tools/execute_intent` (supports `X-Browser-Use-API-Key`)
- `POST /api/tools/intent_status`
- `POST /api/tools/run_status`

## tracing + observability

execute responses include:

- `traceId`
- `runId`
- `taskId`
- `status`

lifecycle emits currently include:

- `started`
- `rail_selected`
- `failed`
- `confirmed`

optional external sinks (server env):

- `LAMINAR_INGEST_URL` (+ optional `LAMINAR_API_KEY`)
- `HUD_TRACE_URL` (+ optional `HUD_API_KEY`)

## rails

- `auto` (currently resolves to `x402`)
- `x402` (scaffold/routing)
- `bitrefill` (scaffold/routing)
- `card` (scaffold/routing)

## current build status

working now:
- end-to-end intent -> execute -> run_status
- browser-use execution verified
- trace ids returned and stored in events

not final yet:
- full rail settlement logic
- hardened production auth policy
- advanced swarm comparison dashboards


## packaged north-star (agent self-bootstrap)

bip should support a full self-bootstrap flow for any external agent:

1. create agent identity + api key
2. provision agentmail inbox
3. provision agent wallet(s) (sol/base)
4. fund wallet and credit ledger
5. run signup/purchase intents (e.g. api key purchase)
6. store credential as `secretRef` (never plaintext)
7. if blocked, return `action_required` + real `liveSessionUrl`, then resume

### target endpoints (next)

- `POST /api/tools/agent_bootstrap`
- `POST /api/tools/wallet_deposit`
- `POST /api/tools/create_intent` (`intentType=api_key_purchase`)
- `POST /api/tools/execute_intent`
- `POST /api/tools/intent_resume`
- `POST /api/tools/intent_status`
- `POST /api/tools/run_status`

this is the packaged skill positioning: **hosted agent commerce runtime**.
