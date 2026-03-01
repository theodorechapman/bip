/**
 * Demo provider — tests the full agent identity stack:
 *   - AgentMail for email
 *   - JoltSMS for phone verification
 *   - browser-use for automation
 *
 * Run: bun src/providers/demo-signup.ts [url]
 * Default target: https://github.com/signup
 */

import { Agent, BrowserSession, BrowserProfile, Controller, ActionResult } from "browser-use";
import { ChatOpenAI } from "browser-use/llm/openai";
import { ChatAnthropic } from "browser-use/llm/anthropic";
import {
  createOrReuseInbox,
  getExistingMessageIds,
  waitForEmail,
  extractVerificationLink,
} from "../agentmail-client";
import { registerPhoneActions } from "./phone-verify";

const PASSWORD = "BipAgent2026!xK9";

function getLLM() {
  if (process.env.OPENAI_API_KEY) {
    return new ChatOpenAI({ model: "gpt-4o", apiKey: process.env.OPENAI_API_KEY });
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return new ChatAnthropic({
      model: "claude-sonnet-4-20250514",
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  throw new Error("Set OPENAI_API_KEY or ANTHROPIC_API_KEY in .env");
}

export async function demoSignup(targetUrl?: string): Promise<string | null> {
  const url = targetUrl ?? "https://github.com/signup";

  // ── Email identity ──
  const inbox = await createOrReuseInbox(true);
  const email = inbox.email || inbox.inbox_id;
  const knownIds = await getExistingMessageIds(inbox.inbox_id);
  console.log(`\n   Email: ${email}`);

  // ── Phone identity ──
  const controller = new Controller();
  const phone = await registerPhoneActions(controller);
  console.log(`   Phone: ${phone.phoneNumber}`);

  // ── Email verification action ──
  controller.registry.action(
    "Check the agent's email inbox for a verification email and return the verification link or code. Call this when the site says to verify your email.",
    {},
  )(async function check_verification_email() {
    console.log("   [Action] Checking inbox for verification email...");
    const msg = await waitForEmail(inbox.inbox_id, knownIds, 90, 2);
    if (msg) {
      const link = extractVerificationLink(msg);
      const body = msg.text || msg.html || "";
      // Try to extract a code from email too
      const codeMatch = body.match(/\b(\d{4,8})\b/);
      if (link) {
        return new ActionResult({
          extracted_content: `Verification link: ${link}${codeMatch ? `\nVerification code: ${codeMatch[1]}` : ""}`,
        });
      }
      if (codeMatch) {
        return new ActionResult({
          extracted_content: `Email verification code: ${codeMatch[1]}`,
        });
      }
      return new ActionResult({
        extracted_content: `Email received but no verification link/code found. Body: ${body.slice(0, 500)}`,
      });
    }
    return new ActionResult({
      extracted_content: "No verification email received within timeout.",
    });
  });

  const profile = new BrowserProfile({
    headless: false,
    highlight_elements: true,
  });
  const browserSession = new BrowserSession({ browser_profile: profile });

  const task = `
You are automating account signup on a website.

TARGET URL: ${url}

You have these tools available:
- get_phone_number: Returns a real US phone number you can enter on forms
- check_phone_otp: Waits for and returns an SMS verification code sent to that phone
- check_verification_email: Waits for and returns email verification link/code

CREDENTIALS (use sensitive data):
- email: use the sensitive data 'email'
- password: use the sensitive data 'password'
- phone: use the sensitive data 'phone' OR call get_phone_number

STEPS:
1. Navigate to ${url}
2. Find the signup/register form
3. Fill in: email, password (and username if needed - use something like "bip-agent-" + random 4 digits)
4. If phone number is required, enter the phone number from sensitive data 'phone'
5. Submit the form
6. If email verification is needed, use check_verification_email to get the link/code
7. If phone/SMS verification is needed, use check_phone_otp to get the OTP code
8. Enter any verification codes on the form
9. Complete any onboarding steps
10. Once signed up, return "SIGNUP_COMPLETE" as your final answer

If you encounter CAPTCHAs you cannot solve, return "BLOCKED_BY_CAPTCHA".
If signup fails for another reason, return "FAILED: <reason>".
`;

  const agent = new Agent({
    task,
    llm: getLLM(),
    browser_session: browserSession,
    controller,
    max_actions_per_step: 5,
    use_vision: true,
    sensitive_data: {
      "*": { email, password: PASSWORD, phone: phone.phoneNumber },
    },
  });

  try {
    const history = await agent.run(60);
    const final = history.final_result();
    console.log(`\n   Result: ${final}`);
    return final ? String(final) : null;
  } catch (e) {
    console.error("   Error:", e);
    return null;
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
