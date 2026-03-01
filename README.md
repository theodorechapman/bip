# MoonPay-Style Agent Auth Demo (TypeScript + Convex)

This repo now contains a demo CLI application that mirrors MoonPay's agent authentication flow:

1. `login` with `email + captchaToken`
2. `verify` with `email + 6-digit OTP`
3. store encrypted credentials locally
4. call protected tool endpoints with bearer token
5. auto-refresh on expiry / `401`

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

Use the CLI through npm scripts:

```bash
bun run cli -- consent accept
bun run cli -- login --email you@example.com --captcha-token 10000000-aaaa-bbbb-cccc-000000000001
bun run cli -- verify --email you@example.com --code 123456
bun run cli -- user retrieve
```

### Demo OTP

For local testing, `login` returns a `debugCode` in the response so you can immediately run `verify`.

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

## Commands

- `consent accept`
- `consent check`
- `config:set-base-url --url <url>`
- `login --email <email> [--captcha-token <token>]`
- `verify --email <email> --code <6-digit>`
- `refresh`
- `user retrieve`
- `logout`

## Typecheck

```bash
bun run typecheck
```
