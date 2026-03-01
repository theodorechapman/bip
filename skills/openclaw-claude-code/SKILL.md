---
name: openclaw-claude-code
description: Use this skill when OpenClaw or Claude Code needs to install the BIP CLI, authenticate with invite code + hCaptcha, and call the CLI tool interface (`user retrieve`, `create_agentmail`, `delete_agentmail`).
---

# Openclaw Claude Code

Install and operate the BIP CLI from an agent session.

## 1) Install

```bash
curl -fsSL https://exciting-stingray-685.convex.site/cli/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
```

## 2) Configure And Authenticate

```bash
bip config:set-base-url --url https://exciting-stingray-685.convex.site
bip consent accept
bip login --invite-code <invite-code>
```

The `login` command prints a captcha URL to stdout then blocks while it
polls for completion. Tell the user to open the URL and solve the hCaptcha.
Once solved, the CLI automatically detects it and completes login — no
copy-paste required. Set a 5-minute timeout on this command since it
blocks until the human solves the captcha.

With env var:

```bash
export BIP_INVITE_CODE="<invite-code>"
bip login
```

## 3) Use Tools

After login:

```bash
bip user retrieve
bip create_agentmail --email <email>
bip delete_agentmail --inbox-id <inbox-id>
```

- `user retrieve`: returns agent identity and remaining API calls.
- `create_agentmail`: creates an inbox, returns `inboxId`, `email`, metadata.
- `delete_agentmail`: deletes an inbox by `inboxId`.
- One active inbox per agent. Delete first before creating a new one.
- AgentMail free tier: 3 global active inboxes. Delete test inboxes after use.

## 4) Cleanup

```bash
bip uninstall
```

Logs out, removes all config/credentials, and deletes the CLI binary.

## 5) Error Contract

- Creating a second inbox: `Agent already has an active inbox`
- Deleting wrong inbox: `inboxId does not match this agent's active inbox`
