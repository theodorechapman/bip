export function renderSkillMarkdown(origin: string): string {
  return `---
name: bip
version: 1.1.0
description: "Hosted agent commerce runtime: authenticated paid intents in, fulfillment artifacts out."
tags: [agents, commerce, payments, x402, gift-cards, api-keys, automation, shopify, dropshipping]
metadata:
  openclaw:
    emoji: "🧠"
  homepage: ${origin}/skill.md
---

# bip skill.md

bip is infrastructure for autonomous agents.

agents should only need to:
1) authenticate
2) pay/fund access (x402/wallet policy)
3) request intents

bip handles the rest: execution orchestration, checkout/payment workflows, artifact return, tracing, and ledger audit.

base url: \`${origin}\`

## quick start

\`\`\`bash
# authenticate
TOKEN=$(curl -s -X POST "${origin}/auth/login" \\
  -H "content-type: application/json" \\
  -H "x-agent-id: agent-$(date +%s)" \\
  -d '{"inviteCode":"YOUR_CODE","captchaToken":"10000000-aaaa-bbbb-cccc-000000000001"}' | jq -r '.accessToken')

# see what's available
curl -s -X POST "${origin}/api/tools/offering_list" \\
  -H "authorization: Bearer $TOKEN" \\
  -d '{}' | jq '.offerings'

# create + execute an intent
INTENT=$(curl -s -X POST "${origin}/api/tools/create_intent" \\
  -H "authorization: Bearer $TOKEN" \\
  -H "content-type: application/json" \\
  -d '{"intentType":"shopify_cycle","provider":"shopify","task":"full dropship cycle","budgetUsd":25,"metadata":{"keywords":["trending gadgets"],"maxProducts":5,"marginPct":50}}' | jq -r '.intentId')

curl -s -X POST "${origin}/api/tools/execute_intent" \\
  -H "authorization: Bearer $TOKEN" \\
  -H "x-idempotency-key: exec-$INTENT-1" \\
  -d "{\\"intentId\\":\\"$INTENT\\"}" | jq
\`\`\`

## core endpoints
- POST /auth/login
- POST /api/tools/offering_list
- POST /api/tools/create_intent
- POST /api/tools/approve_intent
- POST /api/tools/execute_intent
- POST /api/tools/intent_resume
- POST /api/tools/intent_status
- POST /api/tools/run_status
- POST /api/tools/spend_summary
- POST /api/tools/wallet_deposit_address
- POST /api/tools/funding_sync
- POST /api/tools/funding_status
- POST /api/tools/funding_mark_settled (admin override)

## notes
- offering registry + policy caps + idempotency enforced
- outputs include run/trace ids and fulfillment artifacts
- secrets are returned by reference (secretRef)
`;
}
