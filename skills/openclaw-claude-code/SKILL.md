---
name: openclaw-claude-code
description: Use this skill when OpenClaw or Claude Code needs to install the BIP CLI, authenticate with invite code + hCaptcha, and call the CLI tool interface (`user retrieve`, `create_agentmail`, `delete_agentmail`).
---

# Openclaw Claude Code

Install and operate the BIP CLI from an agent session.

## 1) Download And Install CLI

```bash
git clone <your-repo-url>
cd bip
bun install
```

## 2) Configure And Authenticate

Run from repo root:

```bash
bun run cli -- config:set-base-url --url <convex-site-url>
bun run cli -- consent accept
bun run cli -- login --invite-code <invite-code> --captcha-token <captcha-token>
```

Non-interactive auth:

```bash
export BIP_INVITE_CODE="<invite-code>"
bun run cli -- login --captcha-token <captcha-token>
```

## 3) Interface Contract

Use these commands after login:

```bash
bun run cli -- user retrieve
bun run cli -- create_agentmail --email <email>
bun run cli -- delete_agentmail --inbox-id <inbox-id>
```

Expected behavior:

- `user retrieve`: returns authenticated agent/session identity and remaining API calls.
- `create_agentmail`: creates an inbox and returns `inboxId`, `email`, and metadata.
- `delete_agentmail`: deletes an inbox by `inboxId`.
- AgentMail free tier is treated as `3` active inboxes; delete test inboxes after creation checks.
