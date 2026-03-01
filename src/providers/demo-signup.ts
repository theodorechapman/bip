/**
 * Demo provider — tests the agent identity stack:
 *   - AgentMail for email
 *   - Browser Use Cloud API for automation
 *
 * Run: bun src/providers/demo-signup.ts [url]
 * Default target: https://github.com/signup
 */

import { getBrowserUseClient } from "../../scenarios/browser-use/client";
import {
  createOrReuseInbox,
  getExistingMessageIds,
  waitForEmail,
  extractVerificationLink,
} from "../agentmail-client";

import { randomBytes } from "node:crypto";

function generatePassword(): string {
  return randomBytes(16).toString("base64url") + "!A1";
}

export async function demoSignup(targetUrl?: string): Promise<string | null> {
  const url = targetUrl ?? "https://github.com/signup";

  // ── Email identity ──
  const inbox = await createOrReuseInbox(true);
  const email = inbox.email || inbox.inbox_id;
  const knownIds = await getExistingMessageIds(inbox.inbox_id);
  const password = generatePassword();
  console.log(`\n   Email: ${email}`);

  const client = getBrowserUseClient();

  // Create a session with keepAlive for multi-step flow
  let sessionId: string | undefined;
  try {
    const session = await client.sessions.create({
      keepAlive: true,
      proxyCountryCode: "us",
    });
    sessionId = session.id;
  } catch (err: any) {
    console.error("   Failed to create browser session:", err?.message);
    throw new Error("BROWSER_USE_API_KEY required for demo signup");
  }

  try {
    // ── Step 1: Navigate and sign up ──
    console.log("   [1/2] Starting signup...");

    const signupTask = `
You are automating account signup on a website.

TARGET URL: ${url}

CREDENTIALS:
- email: ${email}
- password: ${password}

STEPS:
1. Navigate to ${url}
2. Find the signup/register form
3. Fill in: email, password (and username if needed - use something like "bip-agent-${Math.random().toString(36).slice(2, 6)}")
4. Submit the form
5. If the site says to verify your email, stop and report "VERIFICATION_NEEDED"
6. If signup completes without email verification, report "SIGNUP_COMPLETE"

If you encounter CAPTCHAs you cannot solve, report "BLOCKED_BY_CAPTCHA".
If signup fails for another reason, report "FAILED: <reason>".
`.trim();

    const signupResult = await client.run(signupTask, {
      sessionId,
      timeout: 180_000,
    });

    const output = String(signupResult.output ?? "");
    console.log(`   Signup result: ${output.slice(0, 200)}`);

    // ── Step 2: Email verification if needed ──
    if (output.includes("VERIFICATION_NEEDED") || output.includes("verify")) {
      console.log("   [2/2] Checking for verification email...");

      const msg = await waitForEmail(inbox.inbox_id, knownIds, 90, 2);
      if (msg) {
        const link = extractVerificationLink(msg);
        const body = msg.text || msg.html || "";
        const codeMatch = body.match(/\b(\d{4,8})\b/);

        if (link || codeMatch) {
          const verifyInfo = link
            ? `Navigate to this verification link: ${link}`
            : `Enter this verification code on the page: ${codeMatch![1]}`;

          const verifyTask = `
${verifyInfo}

After verification completes, report "SIGNUP_COMPLETE".
If it fails, report "FAILED: <reason>".
`.trim();

          const verifyResult = await client.run(verifyTask, {
            sessionId,
            timeout: 120_000,
          });

          const verifyOutput = String(verifyResult.output ?? "");
          console.log(`\n   Result: ${verifyOutput.slice(0, 200)}`);
          return verifyOutput || null;
        } else {
          console.log("   Email received but no verification link/code found");
          return "FAILED: no verification link in email";
        }
      } else {
        console.log("   No verification email received");
        return "FAILED: no verification email";
      }
    }

    return output || null;
  } catch (e: any) {
    console.error("   Error:", e?.message ?? e);
    return null;
  } finally {
    if (sessionId) {
      try {
        await client.sessions.stop(sessionId);
      } catch {
        // best-effort cleanup
      }
    }
  }
}

// Run directly
if (import.meta.main) {
  const url = process.argv[2];
  demoSignup(url).then((result) => {
    console.log(`\nFinal: ${result}`);
    process.exit(result ? 0 : 1);
  });
}
