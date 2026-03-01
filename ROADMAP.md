# bip roadmap (locked scope)

## product definition
bip is a hosted agent-commerce runtime: hosted skills/workflows + API-key access for external agents to fund wallets and execute purchases/tasks.

## v1 (done-ish)
- hosted API + auth/session
- intent create/execute/status
- browser-use execution
- trace ids + lifecycle events
- hosted skill docs endpoint (`/skill.md`)

## v1.5 (in progress, next mandatory)
- agent wallet balances (per agent)
- append-only ledger entries
- funds hold -> settle/release path
- insufficient funds enforcement before execute
- idempotent execute + intent lock

## v1.6 (purchase-focused)
- intent type: `api_key_purchase`
- provider allowlist + policy checks
- proof artifacts contract
- secret ref output contract (no plaintext credentials in logs)

## v2
- real rails settlement adapters (bitrefill/x402/sol/base)
- multi-chain balance model
- advanced evals + dashboards
