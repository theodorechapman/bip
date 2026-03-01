# spec: api key purchase intent

## intent payload
```json
{
  "intentType": "api_key_purchase",
  "provider": "openrouter",
  "task": "buy/open account and add initial credits",
  "budgetUsd": 12,
  "rail": "auto",
  "accountEmail": "optional",
  "metadata": {"plan": "starter"}
}
```

## financial lifecycle
1. create intent
2. reserve hold (`holdAmountCents`)
3. execute workflow
4. on success: `debit_settlement`
5. on fail: `hold_release`

## output contract
```json
{
  "status": "ok",
  "runId": "run_x",
  "traceId": "tr_run_x",
  "credential": {
    "type": "api_key",
    "secretRef": "sec_x",
    "provider": "openrouter"
  },
  "proof": {
    "orderRef": "optional",
    "artifacts": ["shot_1", "shot_2"]
  }
}
```

## hard requirements
- no plaintext secret output in logs/events
- append-only ledger
- idempotency key support on execute endpoint
- insufficient funds must fail before execution
