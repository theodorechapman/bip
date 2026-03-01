# bip

managed infrastructure that gives any agent economic capability.

## one-line install

```bash
curl -sSL bip.dev/install.sh | sh
```

agent reads `skill.md` from bip to discover capabilities. no sdk. no docs scraping. one url.

## what bip is

bip gives agents five core capabilities:

1. **autonomous service provisioning** — agent signs up for services, verifies email, extracts API keys, stores credentials. no human involvement.
2. **funded spending with guardrails** — Solana wallet per agent, real balance, full ledger, policy rails (per-intent budget caps, daily limits, provider allowlists).
3. **autonomous email verification** — AgentMail gives agent a real inbox. bip polls it, clicks verification links, enters codes, continues flows automatically.
4. **shopify dropshipping on autopilot** — sources from CJ Dropshipping, lists products with LLM-generated copy, fulfills orders. full API-driven pipeline.
5. **x.com account creation and posting** — creates real X accounts with captcha solving, posts content autonomously.

## how it works

```
install → discover → authenticate → create_intent → approve → execute → poll → consume
```

1. install: `curl -sSL bip.dev/install.sh | sh`
2. discover: agent reads `$BASE/skill.md`
3. authenticate: `POST /auth/login` with invite code
4. intent lifecycle: `create_intent → approve_intent → execute_intent → intent_status`
5. consume: credential refs, artifacts, traces, ledger records

## the demo

```
"get me an OpenRouter API key with $20 of credits"
→ agent spins up AgentMail inbox
→ navigates to OpenRouter, signs up
→ receives and clicks verification email autonomously
→ funds wallet, pays for credits
→ extracts sk-or-xxxx key
→ returns key, immediately uses it to make an LLM call
90 seconds. zero humans. real key. real money. real call.
```

## what bip hosts

**identity layer:**
- AgentMail inboxes managed per agent
- Browser Use Cloud sessions with persistent profiles
- encrypted credential storage (API keys, wallet keys, store configs)

**compute layer:**
- Browser Use execution with stealth, proxy routing, captcha handling
- Arkose/FunCaptcha solving via 2Captcha for X.com signup
- email verification loops (link clicking + code entry)
- step-chained intent orchestration within Convex action timeouts

**financial layer:**
- Solana wallet generation and custody per agent
- full ledger: deposits, holds, debits, settlements, releases
- on-chain funding sync from Solana deposits
- payment rail routing: x402, Bitrefill gift cards, treasury prepaid cards
- per-intent hold/settle/release bookkeeping

**policy layer:**
- per-intent budget caps
- daily spend limits per offering
- provider allowlists
- session-level API call quotas

## what's built and working

- **auth:** invite codes, hCaptcha verification, session tokens, rate limiting (per-subject + per-IP), quota enforcement
- **wallet + ledger:** Solana wallet generation, SOL transfers, on-chain funding sync, hold/settle/release bookkeeping
- **intent lifecycle:** create → approve → execute → status, with auto-approval below $10
- **agentmail:** inbox creation, webhook processing, verification email polling, link + code extraction
- **browser automation:** Browser Use Cloud task/skill execution, session management, proxy routing, profile persistence
- **captcha solving:** Arkose/FunCaptcha via 2Captcha API with token injection
- **bitrefill rail:** gift card purchase API
- **openrouter key purchase:** end-to-end working — signup, verify, key extract, validation
- **shopify module:** store creation (step-chained), CJ product sourcing, Shopify listing with LLM copy, order fulfillment
- **x.com:** account bootstrap with captcha solving, email verification code entry, posting via browser automation
- **treasury:** prepaid card pool management for legacy checkout flows
- **observability:** trace event emission to Laminar/HUD via HTTP
- **secrets:** encrypted credential storage with per-user isolation

## api surface

```
POST /auth/login                        — authenticate
POST /auth/logout                       — revoke session

POST /api/tools/user_retrieve           — get agent identity
POST /api/tools/agent_bootstrap         — provision inbox + wallet
POST /api/tools/create_agentmail        — create email inbox
POST /api/tools/delete_agentmail        — delete email inbox

POST /api/tools/wallet_deposit_address  — get deposit address
POST /api/tools/wallet_generate         — new wallet
POST /api/tools/wallet_balance          — check balance
POST /api/tools/wallet_transfer         — SOL transfer
POST /api/tools/wallet_deposit          — credit account
POST /api/tools/register_wallet         — register external wallet
POST /api/tools/funding_sync            — sync on-chain deposits
POST /api/tools/funding_status          — check funding status
POST /api/tools/funding_mark_settled    — admin: manual credit

POST /api/tools/offering_list           — list offerings + policies
POST /api/tools/create_intent           — create intent
POST /api/tools/approve_intent          — approve intent
POST /api/tools/execute_intent          — execute intent
POST /api/tools/intent_status           — get intent status + events
POST /api/tools/intent_resume           — resume action_required intent
POST /api/tools/run_status              — get run details
POST /api/tools/spend_summary           — aggregate spend

POST /api/tools/shopify_register        — register store creds
POST /api/tools/secrets_get             — retrieve credential
POST /api/tools/treasury_card_add       — add treasury card (admin)
POST /api/tools/treasury_card_list      — list treasury cards (admin)

POST /webhooks/agentmail                — webhook receiver
POST /waitlist                          — waitlist signup

GET  /skill.md                          — agent capability discovery
GET  /install.sh                        — one-line install script
```

## quick api flow

```bash
BASE="https://wonderful-goose-918.convex.site"
INVITE_CODE="opalbip2026"
CAPTCHA_TOKEN="10000000-aaaa-bbbb-cccc-000000000001"

RESP=$(curl -s -X POST "$BASE/auth/login" \
  -H "content-type: application/json" \
  -H "x-agent-id: bootstrap" \
  -d "{\"inviteCode\":\"$INVITE_CODE\",\"captchaToken\":\"$CAPTCHA_TOKEN\"}")

TOKEN=$(echo "$RESP" | jq -r '.accessToken')
AGENT_ID=$(echo "$RESP" | jq -r '.agentId')

INTENT=$(curl -s -X POST "$BASE/api/tools/create_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-agent-id: $AGENT_ID" \
  -H "content-type: application/json" \
  -d '{"intentType":"api_key_purchase","provider":"openrouter","task":"create OpenRouter API key","budgetUsd":5,"rail":"auto","metadata":{"provider":"openrouter","accountEmailMode":"agentmail","targetProduct":"starter"}}' \
  | jq -r '.intentId')

curl -s -X POST "$BASE/api/tools/approve_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-agent-id: $AGENT_ID" \
  -H "content-type: application/json" \
  -d "{\"intentId\":\"$INTENT\"}" > /dev/null

curl -s -X POST "$BASE/api/tools/execute_intent" \
  -H "authorization: Bearer $TOKEN" \
  -H "x-agent-id: $AGENT_ID" \
  -H "x-idempotency-key: exec-$INTENT-1" \
  -H "content-type: application/json" \
  -d "{\"intentId\":\"$INTENT\"}" | jq '{status, runId, traceId, output, artifact}'
```

## tech stack

- **backend:** Convex (database + HTTP actions + scheduler)
- **runtime:** Bun
- **browser automation:** Browser Use Cloud (sessions, tasks, skills)
- **email:** AgentMail (inboxes, webhooks)
- **on-chain:** Solana (wallet gen, transfers, funding sync)
- **payments:** x402, Bitrefill API, prepaid treasury cards
- **captcha:** 2Captcha (Arkose/FunCaptcha solving)
- **auth:** invite codes, hCaptcha, SHA-256 token hashing
- **observability:** Laminar, HUD (trace events via HTTP)
- **llm:** Anthropic Claude (Shopify product copy)

## local dev

```bash
bun install
bun run convex:dev
bun run typecheck
```

## the thesis

the entire web was built to keep bots out — CAPTCHAs, email verification, payment friction, bot detection. that assumption is now wrong. agents are the future users of the internet.

bip bridges two eras:
- **today:** agents navigate the legacy human web via browser automation
- **tomorrow:** agents transact natively via x402 (HTTP 402, machine-to-machine, no forms)

bip works in both worlds. the intent abstraction (`create → approve → execute`) is the connective tissue.
