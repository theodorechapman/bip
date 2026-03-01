/**
 * OpenRouter provider — automates signup and API key creation using Browser Use Cloud API.
 * Port of bip-bu/providers/openrouter.py, rewritten for the Cloud API task-based approach.
 */

import { getBrowserUseClient } from "../../scenarios/browser-use/client";
import {
  waitForEmail,
  extractVerificationLink,
  getExistingMessageIds,
  createOrReuseInbox,
} from "../agentmail-client";

import { randomBytes } from "node:crypto";

function generatePassword(): string {
  return randomBytes(16).toString("base64url") + "!A1";
}

export async function getOpenRouterKey(): Promise<string | null> {
  // Always create a fresh inbox for signup (previous ones may already be registered)
  const inbox = await createOrReuseInbox(true);
  const email = inbox.email || inbox.inbox_id;
  const knownIds = await getExistingMessageIds(inbox.inbox_id);
  const password = generatePassword();

  console.log(`\n   Using email: ${email}`);

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
    throw new Error("BROWSER_USE_API_KEY required for OpenRouter signup");
  }

  try {
    // ── Step 1: Sign up on OpenRouter ──
    console.log("   [1/3] Starting OpenRouter signup...");

    const signupTask = `
You are automating signup on OpenRouter.

STEP 1 - SIGN UP:
1. Go to https://openrouter.ai/
2. Click "Sign Up" button
3. Use email signup (NOT Google/GitHub OAuth)
4. Email: ${email}
5. Password: ${password}
6. Accept terms checkbox if present
7. Click Continue

After signup, if the site asks you to verify your email, report "VERIFICATION_NEEDED".
If signup completes without email verification, report "SIGNUP_COMPLETE".
If you encounter issues, report "FAILED: <reason>".
`.trim();

    const signupResult = await client.run(signupTask, {
      sessionId,
      allowedDomains: ["*.openrouter.ai", "*.clerk.accounts.dev", "*.accounts.dev"],
      timeout: 180_000,
    });

    const signupOutput = String(signupResult.output ?? "");
    console.log(`   Signup result: ${signupOutput.slice(0, 200)}`);

    // ── Step 2: Email verification ──
    if (signupOutput.includes("VERIFICATION_NEEDED") || signupOutput.includes("verify")) {
      console.log("   [2/3] Checking for verification email...");

      const msg = await waitForEmail(inbox.inbox_id, knownIds, 90, 2);
      if (msg) {
        const link = extractVerificationLink(msg);
        if (link) {
          console.log("   Found verification link, clicking...");

          const verifyTask = `
Navigate to this verification link and complete email verification:
${link}

After verification, handle any onboarding modals or surveys:
- For any survey or questionnaire, select any option and click Continue/Submit
- Do NOT just close modals with X — fill them out so they don't reappear

After verification is complete, report "VERIFIED".
`.trim();

          await client.run(verifyTask, {
            sessionId,
            timeout: 120_000,
          });
          console.log("   Verification completed");
        } else {
          console.log("   Email received but no verification link found, continuing...");
        }
      } else {
        console.log("   No verification email received, continuing...");
      }
    }

    // ── Step 3: Create API key ──
    console.log("   [3/3] Creating API key...");

    const keyTask = `
You are on OpenRouter (or need to navigate there).

STEP 1: Navigate to https://openrouter.ai/settings/keys
STEP 2: If not logged in, sign in with email "${email}" and password "${password}"
STEP 3: Handle any onboarding modals by filling them out and clicking Continue
STEP 4: Click "Create Key" or similar button
STEP 5: Name the key "bip-auto" if asked
STEP 6: IMPORTANT: Copy the full API key value displayed. It starts with "sk-or-"
STEP 7: Return ONLY the API key string (starting with "sk-or-") as your final answer

Do NOT close any modal showing the key before copying it.
`.trim();

    const keyResult = await client.run(keyTask, {
      sessionId,
      allowedDomains: ["*.openrouter.ai", "*.clerk.accounts.dev", "*.accounts.dev"],
      timeout: 180_000,
    });

    const keyOutput = String(keyResult.output ?? "");
    console.log(`   Key result: ${keyOutput.slice(0, 100)}`);

    // Extract the API key
    const keyMatch = keyOutput.match(/sk-or-[a-zA-Z0-9_-]+/);
    if (keyMatch) {
      console.log("   API key obtained successfully");
      return keyMatch[0];
    }

    console.log("   Could not extract API key from output");
    return keyOutput || null;
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
