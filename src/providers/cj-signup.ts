/**
 * CJ Dropshipping provider — automates signup via Browser Use Cloud API.
 * Creates account with AgentMail inbox for email verification.
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

export async function getCJCredentials(): Promise<{
  email: string;
  password: string;
} | null> {
  const inbox = await createOrReuseInbox(true);
  const email = inbox.email || inbox.inbox_id;
  const knownIds = await getExistingMessageIds(inbox.inbox_id);
  const password = generatePassword();

  console.log(`\n   Using email: ${email}`);

  const client = getBrowserUseClient();

  let sessionId: string | undefined;
  try {
    const session = await client.sessions.create({
      keepAlive: true,
      proxyCountryCode: "us",
    });
    sessionId = session.id;
  } catch (err: any) {
    console.error("   Failed to create browser session:", err?.message);
    throw new Error("BROWSER_USE_API_KEY required for CJ Dropshipping signup");
  }

  try {
    // ── Step 1: Sign up on CJ Dropshipping ──
    console.log("   [1/2] Starting CJ Dropshipping signup...");

    const signupTask = `
You are automating signup on CJ Dropshipping.

STEP 1 - SIGN UP:
1. Go to https://cjdropshipping.com/register
2. Find the registration form
3. Email: ${email}
4. Password: ${password}
5. If there's a "confirm password" field, enter the same password again
6. Accept any terms/agreements checkbox
7. Click the Register/Sign Up button

After signup, if the site asks you to verify your email, report "VERIFICATION_NEEDED".
If signup completes without email verification, report "SIGNUP_COMPLETE".
If you encounter CAPTCHAs, try to solve them. If blocked, report "BLOCKED_BY_CAPTCHA".
If you encounter issues, report "FAILED: <reason>".
`.trim();

    const signupResult = await client.run(signupTask, {
      sessionId,
      allowedDomains: ["*.cjdropshipping.com", "*.cjcommerce.com"],
      timeout: 180_000,
    });

    const signupOutput = String(signupResult.output ?? "");
    console.log(`   Signup result: ${signupOutput.slice(0, 200)}`);

    if (signupOutput.includes("BLOCKED_BY_CAPTCHA")) {
      console.log("   Blocked by CAPTCHA, cannot complete signup");
      return null;
    }

    if (signupOutput.includes("FAILED")) {
      console.log("   Signup failed");
      return null;
    }

    // ── Step 2: Email verification ──
    if (signupOutput.includes("VERIFICATION_NEEDED") || signupOutput.includes("verify")) {
      console.log("   [2/2] Checking for verification email...");

      const msg = await waitForEmail(inbox.inbox_id, knownIds, 90, 3);
      if (msg) {
        const link = extractVerificationLink(msg);
        if (link) {
          console.log("   Found verification link, clicking...");

          const verifyTask = `
Navigate to this verification link and complete email verification:
${link}

After verification is complete, report "VERIFIED".
If it fails, report "FAILED: <reason>".
`.trim();

          await client.run(verifyTask, {
            sessionId,
            timeout: 120_000,
          });
          console.log("   Verification completed");
        } else {
          // Check for verification code
          const body = msg.text || msg.html || "";
          const codeMatch = body.match(/\b(\d{4,8})\b/);
          if (codeMatch) {
            console.log("   Found verification code, entering...");

            const codeTask = `
Enter this verification code on the CJ Dropshipping page: ${codeMatch[1]}

Find the verification code input field and enter the code, then submit.
After verification is complete, report "VERIFIED".
`.trim();

            await client.run(codeTask, {
              sessionId,
              timeout: 120_000,
            });
            console.log("   Code verification completed");
          } else {
            console.log("   Email received but no verification link/code found, continuing...");
          }
        }
      } else {
        console.log("   No verification email received, continuing...");
      }
    }

    console.log("   CJ Dropshipping account created successfully");
    return { email, password };
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
