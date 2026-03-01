# payments gateway test plan (hackathon-fast)

## 0) env + services
- run `bun run convex:dev`
- set `BROWSER_USE_API_KEY`
- set `PAYMENTS_MODE=free` first

## 1) auth smoke
1. `consent accept`
2. `login` with invite code + captcha test token
3. `user retrieve` should return agent id + quota metadata

## 2) wallet smoke
1. `wallet_register --chain solana --address <addr>`
2. `wallet_balance --chain solana`
3. verify response has wallet object

## 3) intent lifecycle smoke
1. `intent_create --budget-usd 8` -> should be `approved` (<=10)
2. `intent_execute` -> should return run id
3. `intent_status` -> should show events + status `submitted/confirmed/failed`
4. `run_status` -> should show run details

## 4) approval path
1. `intent_create --budget-usd 25` -> should be `needs_approval`
2. `intent_execute` before approve should fail
3. `intent_approve`
4. `intent_execute` now allowed

## 5) metered gate path
1. set `PAYMENTS_MODE=metered`
2. set `MIN_INTENT_BUDGET_USD=10`
3. create `budget-usd 3` intent (approved or needs_approval depending policy)
4. execute should return `payment_required` with reason `budget_below_minimum`

## 6) bu failure path
- unset `BROWSER_USE_API_KEY`
- execute approved intent
- expect failed run + `intent_execution_failed` event

## 7) golden demo script
- create intent (clear task)
- execute
- poll run status once
- show intent events timeline

## assertion checklist
- no silent failures
- every execution writes events
- run ids are unique
- status transitions are monotonic
- auth token required for all tool endpoints
