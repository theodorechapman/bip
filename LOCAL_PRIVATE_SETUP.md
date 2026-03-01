# local private bip setup

## 1) run local backend only

```bash
cd ~/Desktop/codebase/bip
CONVEX_AGENT_MODE=anonymous npx convex dev --local
```

keep this terminal running.

## 2) keep secrets local only

store secrets in your shell (not in git, not in chat logs):

```bash
export BROWSER_USE_API_KEY='...'
export AGENTMAIL_API_KEY='...'
export BITREFILL_API_KEY='...'
export AUTH_BYPASS='true'
```

## 3) local-first testing

use your local convex site url (from `convex dev --local` output) as `BASE` and run skill flow against that.

## 4) optional private external access

if you need remote agents to call local bip, expose a private tunnel:

```bash
# cloudflared example
cloudflared tunnel --url http://127.0.0.1:3210
```

then use tunnel URL as BASE.

## 5) security rules

- never commit `.env.local` with real secrets
- rotate any key pasted in chat
- prefer short-lived keys/tokens where possible
