# MoonPay-Style Agent Auth Demo (TypeScript + Convex)

This repo contains a demo CLI application with a simplified MoonPay-style flow:

1. `login` with `inviteCode + hCaptcha` (no email OTP)
2. issue a 24-hour bearer session token
3. enforce a per-session API call quota on protected endpoints
4. enforce one active AgentMail inbox per authenticated agent
5. store encrypted credentials locally
6. call protected tool endpoints (including `create_agentmail`)

## Stack

- Convex HTTP actions + Convex DB
- TypeScript CLI (`commander`)
- Local credential encryption (`aes-256-gcm` + `scrypt`)

## Install

```bash
bun install
```

## Start Convex local deployment

```bash
bun run convex:dev
```

This starts local Convex and writes `.env.local` including:

- `CONVEX_URL`
- `CONVEX_SITE_URL`

## CLI usage

Public install (no repo clone required):

```bash
curl -fsSL https://exciting-stingray-685.convex.site/cli/install.sh | sh
```

Then use the installed `bip` command:

```bash
bip config:set-base-url --url https://exciting-stingray-685.convex.site
bip consent accept
bip login --invite-code "<invite-code>" --captcha-token 10000000-aaaa-bbbb-cccc-000000000001
bip user retrieve
bip create_agentmail --email openclaw-demo@yourdomain.com
bip delete_agentmail --inbox-id openclaw-demo@yourdomain.com
```

Manifest endpoint:

```bash
curl -fsSL https://exciting-stingray-685.convex.site/cli/manifest.json
```

The public CLI sends `X-Agent-Id` from local consent metadata and receives a session token valid for 24 hours.

### Invite code setup

Set an invite code gate on Convex:

```bash
bunx convex env set INVITE_CODES "<invite-code>"
```

For production:

```bash
bunx convex env set --prod INVITE_CODES "<invite-code>"
```

You can set multiple codes as a comma-separated list:

```bash
bunx convex env set --prod INVITE_CODES "code-a,code-b,code-c"
```

Optional local convenience for CLI:

```bash
export BIP_INVITE_CODE="<invite-code>"
```

### hCaptcha setup

Set environment variables on Convex for your deployment:

```bash
bunx convex env set HCAPTCHA_SECRET_KEY "<your-hcaptcha-secret>"
bunx convex env set HCAPTCHA_SITE_KEY "<your-hcaptcha-site-key>"
```

For production:

```bash
bunx convex env set --prod HCAPTCHA_SECRET_KEY "<your-hcaptcha-secret>"
bunx convex env set --prod HCAPTCHA_SITE_KEY "<your-hcaptcha-site-key>"
```

For test/demo mode with hCaptcha test keys, use:

- `HCAPTCHA_SITE_KEY=10000000-ffff-ffff-ffff-000000000001`
- `HCAPTCHA_SECRET_KEY=0x0000000000000000000000000000000000000000`

### AgentMail setup

Set backend environment variables:

```bash
bunx convex env set AGENTMAIL_API_KEY "<your-agentmail-api-key>"
```

Optional (defaults to `https://api.agentmail.to`):

```bash
bunx convex env set AGENTMAIL_BASE_URL "https://api.agentmail.to"
```

For production:

```bash
bunx convex env set --prod AGENTMAIL_API_KEY "<your-agentmail-api-key>"
bunx convex env set --prod AGENTMAIL_BASE_URL "https://api.agentmail.to"
```

## Commands

- `consent accept`
- `consent check`
- `config:set-base-url --url <url>`
- `login --invite-code <code> [--captcha-token <token>]`
- `user retrieve`
- `create_agentmail --email <email>`
- `delete_agentmail --inbox-id <inboxId>`
- `wallet_register --chain <chain> --address <address> [--label <label>]`
- `wallet_balance [--chain <chain>]`
- `intent_create --task <task> [--budget-usd <usd>] [--rail <rail>]`
- `intent_approve --intent-id <intentId>`
- `intent_execute --intent-id <intentId>`
- `intent_status --intent-id <intentId>`
- `run_status --run-id <runId>`
- `logout`

### Payments execution env

For live Browser Use-backed intent execution:

```bash
export BROWSER_USE_API_KEY="<your-bu-api-key>"
# optional
export BROWSER_USE_API_BASE="https://api.browser-use.com"

# free | metered
export PAYMENTS_MODE="free"
# minimum budget gate in metered mode
export MIN_INTENT_BUDGET_USD="1"
```

## Typecheck

```bash
bun run typecheck
```

## Testing

Run the Bun E2E suite:

```bash
bun run test:e2e
```

What it covers:

- invite-code + hCaptcha login gating
- 24-hour session issuance
- per-session API quota enforcement (`100` calls)
- `create_agentmail` and `delete_agentmail`
- one-active-inbox-per-agent enforcement
- CLI flow (`consent`, `login`, tool calls)

The test harness uses local mock providers for hCaptcha and AgentMail.
It simulates AgentMail free-tier behavior with a cap of `3` active inboxes and validates that deleting an inbox frees a slot.
