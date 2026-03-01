# bip offerings roadmap

this file defines the productized offerings exposed by bip to external agents.

## schema (for every offering)

- `offeringId`
- `intentType`
- `provider`
- `rail`
- `riskClass` (`low|medium|high`)
- `requiresHandoff` (`never|sometimes|often`)
- `inputs`
- `outputs`
- `policy`

---

## phase 1 (current/next)

### 1) gift card purchase
- offeringId: `giftcard.bitrefill.buy`
- intentType: `giftcard_purchase`
- provider: `bitrefill`
- rail: `bitrefill|auto`
- riskClass: `medium`
- requiresHandoff: `sometimes`
- inputs:
  - `brand`
  - `amountUsd`
  - `recipientEmail`
- outputs:
  - `orderId`
  - `codeRef` (or `secretRef`)
  - `receiptRef`
  - `traceId`
- policy:
  - provider allowlist
  - amount cap per intent/day
  - idempotency required

### 2) api key purchase
- offeringId: `apikey.provider.buy`
- intentType: `api_key_purchase`
- provider: `openrouter|...`
- rail: `auto`
- riskClass: `high`
- requiresHandoff: `often`
- inputs:
  - `provider`
  - `budgetUsd`
  - `accountEmailMode` (`agentmail|existing`)
- outputs:
  - `credentialRef`
  - `proofRef`
  - `traceId`
- policy:
  - provider allowlist
  - account ownership checks
  - secret by reference only

### 3) account bootstrap
- offeringId: `account.bootstrap`
- intentType: `account_bootstrap`
- provider: `bitrefill|x|shopify|...`
- rail: `auto`
- riskClass: `medium`
- requiresHandoff: `often`
- inputs:
  - `provider`
  - `emailMode`
- outputs:
  - `accountStatus`
  - `nextAction`
  - `traceId`
- policy:
  - anti-abuse throttle
  - captcha/challenge detection

---

## phase 2 (near-term expansion)

### 4) x account create + verify
- offeringId: `x.account.create_verify`
- intentType: `x_account_bootstrap`
- provider: `x`
- rail: `card|giftcard|auto`
- riskClass: `high`
- requiresHandoff: `often`
- inputs:
  - `profileName`
  - `emailMode`
  - `verificationBudgetUsd`
- outputs:
  - `accountHandle`
  - `verificationStatus`
  - `credentialRef`
  - `traceId`

### 5) domain purchase
- offeringId: `domain.buy`
- intentType: `domain_purchase`
- provider: `namecheap`
- rail: `card|auto`
- riskClass: `medium`
- requiresHandoff: `sometimes`
- inputs:
  - `domainCandidates[]`
  - `maxBudgetUsd`
- outputs:
  - `domain`
  - `orderId`
  - `receiptRef`
  - `traceId`

---

## phase 3 (ops automation)

### 6) doordash-style order
- offeringId: `consumer.food_order`
- intentType: `food_order`
- provider: `doordash|ubereats`
- rail: `card|auto`
- riskClass: `high`
- requiresHandoff: `sometimes`

### 7) shopify run ops
- offeringId: `shopify.ops`
- intentType: `shopify_ops`
- provider: `shopify`
- rail: `auto`
- riskClass: `high`
- requiresHandoff: `sometimes`

---

## universal guardrails (must hold for all offerings)

1. strict auth + scoped keys
2. provider/merchant allowlists
3. per-intent + per-day spend caps
4. idempotency keys on execute
5. append-only ledger + trace linkage
6. kill switch for paid execution
7. secret outputs via reference only

---

## immediate build queue (next)

1. `wallet_transfer` treasury/admin path (controlled)
2. `bitrefill_crypto_checkout` end-to-end completion proof
3. offering registry endpoint (`/api/tools/offering_list`)
4. policy config table (caps/allowlists by offering)
