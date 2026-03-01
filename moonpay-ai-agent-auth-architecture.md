# MoonPay-Style AI Agent Authentication Architecture

Research date: March 1, 2026

## Summary
MoonPay's public AI-agent flow appears to use a layered auth model:

1. `login` step: email + hCaptcha token
2. `verify` step: 6-digit email OTP -> access token + refresh token + expiry
3. Bearer auth on tool calls (`Authorization: Bearer <accessToken>`)
4. Auto-refresh on expiry/401 via `refresh` endpoint
5. Local encrypted credential storage (OS keychain backed)
6. A separate local consent/agent identity record (`agentId`) attached in request headers

This is a solid architecture to copy for an agent product because it combines bot resistance, human identity proof (email OTP), and strong local secret handling.

## What Is Verified (From Sources)

### 1) Agent login flow (MoonPay CLI)
Public MoonPay docs and npm package docs show a CLI flow with `login` then `verify`.

- `mp login --email ...`
- `mp verify --email ... --code ...`
- `mp user retrieve` to check session

MoonPay support docs also show the hCaptcha pre-step and CLI usage pattern for agent login.

### 2) Login requires hCaptcha and verify uses 6-digit OTP
In the published `@moonpay/cli` package schema (v0.11.1):

- `login` requires `email` and `captchaToken`
- `verify` requires `email` and `code` where code pattern is 6 digits
- `verify` returns `accessToken`, `refreshToken`, `expiresAt`

### 3) Session token lifecycle
In the published CLI bundle:

- API tool calls are sent to `https://agents.moonpay.com/api/tools/<tool-name>` by default
- Access token is sent as bearer token
- If a request returns 401 and refresh token exists, CLI calls `refresh`, updates local credentials, and retries
- Preemptive refresh happens near expiry

### 4) Credential storage and encryption model
In the published CLI bundle and skill docs:

- Credentials are persisted in `~/.config/moonpay/credentials.json`
- Data is encrypted with AES-256-GCM
- Key derivation uses scrypt with per-record salt
- Encryption key source order: `MOONPAY_ENCRYPTION_KEY` env var -> OS keychain (macOS keychain / Linux libsecret) -> local fallback file (`~/.config/moonpay/.encryption-key`)
- Wallet files are also encrypted locally

### 5) Agent identity and consent metadata
In the published CLI bundle:

- Consent is tracked in `~/.config/moonpay/consent.json`
- Consent data includes `tosVersion`, `acceptedAt`, and `agentId`
- Requests include metadata headers such as `X-CLI-Version` and `X-Agent-Id`

### 6) Broader MoonPay auth model beyond CLI
MoonPay developer docs describe:

- Auth SDK methods: Email OTP, social login, wallet login
- OAuth 2.0 Authorization Code + PKCE for user authentication and delegated access
- Access token + refresh token usage in OAuth docs

## Inferred Architecture (Clearly Marked as Inference)
Inference: MoonPay is using one auth platform with channel-specific front ends:

- Agent/CLI channel: email OTP + hCaptcha, local token vault, bearer auth to tool APIs
- App/web channel: Auth SDK or OAuth PKCE
- Shared backend: token issuance, refresh, and user resolution

```mermaid
flowchart LR
  A[AI Agent Runtime\nClaude/Codex/MCP Client] --> B[MoonPay CLI or Agent Adapter]
  B --> C[Captcha Solver/Interactive hCaptcha]
  B --> D[Email Inbox Access]

  B --> E[Auth API: login(email,captchaToken)]
  E --> D
  D --> B
  B --> F[Auth API: verify(email, otp)]
  F --> G[(accessToken, refreshToken, expiresAt)]

  G --> H[Local Encrypted Credential Store]
  H --> I[Tool Client]
  I --> J[POST /api/tools/<tool> with Bearer token]

  J --> K{401?}
  K -- no --> L[Tool Response]
  K -- yes --> M[POST /api/tools/refresh]
  M --> H
  H --> I
  I --> J

  N[Consent Store\nagentId + tosVersion] --> I
```

## Architecture You Can Copy

### Auth layers
1. Human ownership proof: email OTP
2. Bot-abuse protection: hCaptcha at login request time
3. Session security: short-lived access token + longer refresh token
4. Agent identity: stable local `agentId` header
5. Local secret protection: encrypted token vault + OS keychain master key

### Suggested API contract

```http
POST /auth/login
{
  "email": "user@example.com",
  "captchaToken": "..."
}
-> 200 { "email": "user@example.com" }

POST /auth/verify
{
  "email": "user@example.com",
  "code": "123456"
}
-> 200 {
  "accessToken": "...",
  "refreshToken": "...",
  "expiresAt": 1772235600
}

POST /auth/refresh
{
  "refreshToken": "..."
}
-> 200 {
  "accessToken": "...",
  "refreshToken": "...",
  "expiresAt": 1772239200
}
```

### Client behavior to match
1. Attach `Authorization: Bearer <accessToken>` on every protected API call
2. On 401, attempt one refresh and retry original request once
3. Lock refresh so concurrent processes do not race (MoonPay uses a lock file pattern)
4. Encrypt stored credentials at rest
5. Keep a consent file with `agentId` and ToS version

## Implementation Blueprint

### Component design
- `auth-service`: login, verify, refresh, revoke
- `mail-otp-service`: OTP generation + verification + rate limiting
- `captcha-validator`: verifies challenge token before OTP send
- `token-service`: issues JWT/PASETO access tokens and refresh tokens
- `agent-client-sdk`: local encrypted store + refresh middleware + lock manager

### Security controls to keep
- OTP TTL: 5-10 minutes
- OTP attempt limits per code and per account
- Login and verify rate limits by IP + email + device
- Refresh token rotation and invalidation on reuse
- Local file permissions (`0600`) for credential material
- Optional device binding on refresh tokens

## Gaps / Unknowns
Not publicly confirmed in the sources:

- MoonPay internal token format/signing strategy
- Exact server-side OTP/captcha/rate-limit thresholds
- Exact access-token TTL used in production
- Whether all tool endpoints require auth vs only selected endpoints

## Sources
- MoonPay support article (CLI + hCaptcha + verify flow): https://support.moonpay.com/developers/docs/using-moonpay-cli-to-empower-ai-agents
- MoonPay developer docs (Auth SDK overview): https://dev.moonpay.com/v1/docs/auth-sdk-overview
- MoonPay developer docs (Auth methods): https://dev.moonpay.com/v1/docs/configure-user-authentication-methods
- MoonPay developer docs (OAuth overview): https://dev.moonpay.com/v1/docs/oauth-overview
- MoonPay developer docs (OAuth app flow): https://dev.moonpay.com/v1/docs/how-to-use-oauth-in-your-app
- npm package page: https://www.npmjs.com/package/@moonpay/cli
- npm tarball metadata/source inspected (v0.11.1): https://registry.npmjs.org/@moonpay/cli/-/cli-0.11.1.tgz

