---
name: bip-payments-gateway
version: 0.1.0
description: "Register an agent, issue API keys, attach wallet, create/approve/execute payment intents, and run Browser Use-backed web tasks through a single endpoint."
tags: [agents, payments, browser-use, api, cli, x402]
metadata:
  openclaw:
    emoji: "🧠"
  homepage: https://github.com/theodorechapman/bip
  requires:
    bins: [bun, bip]
---

# bip payments gateway skill

this skill exposes a unified flow for any agent (including claude code) to run paid web tasks.

## core idea

- agent calls bip endpoint
- bip policy/intent lifecycle decides if task can execute
- bip dispatches browser use task
- bip returns run status + artifacts/events

## setup

```bash
# in repo root
bun install
bun run convex:dev

# required for live browser-use execution
export BROWSER_USE_API_KEY="<your-bu-api-key>"

# optional
export BROWSER_USE_API_BASE="https://api.browser-use.com"

# payments mode
export PAYMENTS_MODE="free"      # or metered
export MIN_INTENT_BUDGET_USD="1" # gate for metered mode
```

## cli flow

```bash
# consent + login first
bun run cli -- consent accept
bun run cli -- login --invite-code "<invite-code>" --captcha-token 10000000-aaaa-bbbb-cccc-000000000001

# optional wallet registration
bun run cli -- wallet_register --chain solana --address <wallet-address> --label main
bun run cli -- wallet_balance --chain solana

# create intent
bun run cli -- intent_create --task "find top 3 yc browser use hackathon posts and summarize" --budget-usd 8 --rail auto

# if needed
bun run cli -- intent_approve --intent-id <intentId>

# execute
bun run cli -- intent_execute --intent-id <intentId>

# track
bun run cli -- intent_status --intent-id <intentId>
bun run cli -- run_status --run-id <runId>
```

## api flow (for claude code / curl agents)

```bash
# create intent
curl -X POST "$BASE/api/tools/create_intent" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"task":"top up openrouter under $8","budgetUsd":8,"rail":"auto"}'

# approve (if needs_approval)
curl -X POST "$BASE/api/tools/approve_intent" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"intentId":"pi_xxx"}'

# execute
curl -X POST "$BASE/api/tools/execute_intent" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"intentId":"pi_xxx"}'

# status
curl -X POST "$BASE/api/tools/intent_status" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"intentId":"pi_xxx"}'
```

## current rails

- `auto` -> resolves to `x402`
- `x402` (routing/scaffold)
- `bitrefill` (routing/scaffold)
- `card` (routing/scaffold)

## current status

- auth/session/quotas: implemented
- wallet register/balance endpoints: implemented
- intent lifecycle + events: implemented
- bu-backed execution + run tracking: implemented
- metered gate (budget threshold): implemented

next: real rail settlement adapters + laminar/hud tracing + swarm comparison.
