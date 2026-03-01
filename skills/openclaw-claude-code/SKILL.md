---
name: openclaw-claude-code
description: Use this skill when OpenClaw or Claude Code needs to install the BIP CLI, authenticate with invite code + hCaptcha, and call the CLI tool interface (`user retrieve`, `create_agentmail`, `delete_agentmail`).
---

# Openclaw Claude Code

Install and operate the BIP CLI from an agent session.

## 1) Download And Install CLI

```bash
curl -fsSL https://exciting-stingray-685.convex.site/cli/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
```

Optional discovery endpoint:

```bash
curl -fsSL https://exciting-stingray-685.convex.site/cli/manifest.json
```

## 2) Configure And Authenticate

Run after install:

```bash
bip config:set-base-url --url https://exciting-stingray-685.convex.site
bip consent accept
bip login --invite-code <invite-code>
```

Non-interactive auth:

```bash
export BIP_INVITE_CODE="<invite-code>"
bip login
```

## 3) Interface Contract

Use these commands after login:

```bash
bip user retrieve
bip create_agentmail --email <email>
bip delete_agentmail --inbox-id <inbox-id>
```

Expected behavior:

- `user retrieve`: returns authenticated agent/session identity and remaining API calls.
- `create_agentmail`: creates an inbox and returns `inboxId`, `email`, and metadata.
- `delete_agentmail`: deletes an inbox by `inboxId`.
- An agent can have only one active inbox/email at a time.
- To create a new inbox for the same agent, call `delete_agentmail` first.
- AgentMail free tier is treated as `3` active inboxes globally; delete test inboxes after checks.

## 4) Error Contract

- If an agent already has one inbox and calls `create_agentmail` again, expect an error containing:
  - `Agent already has an active inbox`
- If delete targets an inbox that is not this agent's active inbox, expect:
  - `inboxId does not match this agent's active inbox`
