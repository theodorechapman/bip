/**
 * OpenRouter provider — automates signup and API key creation using browser-use.
 * Port of bip-bu/providers/openrouter.py.
 */

import { Agent, BrowserSession, BrowserProfile, Controller, ActionResult } from "browser-use";
import { ChatAnthropic } from "browser-use/llm/anthropic";
import { ChatOpenAI } from "browser-use/llm/openai";
import { ChatCodex, isCodexAvailable } from "../llm/codex";
import {
  waitForEmail,
  extractVerificationLink,
  getExistingMessageIds,
  createOrReuseInbox,
} from "../agentmail-client";

const PASSWORD = "BipAgent2026!xK9";

function getLLM() {
  // Prefer Codex (free with ChatGPT Plus/Pro)
  if (isCodexAvailable()) {
    console.log("   Using Codex (free via ChatGPT subscription)");
    return new ChatCodex({ model: "gpt-5.3-codex" });
  }
  if (process.env.OPENAI_API_KEY) {
    console.log("   Using OpenAI gpt-4o");
    return new ChatOpenAI({
      model: "gpt-4o",
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  if (process.env.ANTHROPIC_API_KEY) {
    console.log("   Using Anthropic Claude");
    return new ChatAnthropic({
      model: "claude-sonnet-4-20250514",
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  throw new Error("Set up Codex auth (~/.codex/auth.json), OPENAI_API_KEY, or ANTHROPIC_API_KEY");
}

export async function getOpenRouterKey(): Promise<string | null> {
  // Always create a fresh inbox for signup (previous ones may already be registered)
  const inbox = await createOrReuseInbox(true);
  const email = inbox.email || inbox.inbox_id;
  const knownIds = await getExistingMessageIds(inbox.inbox_id);

  console.log(`\n   Using email: ${email}`);

  // Set up custom controller with email verification action
  const controller = new Controller();
  controller.registry.action(
    "Check the agent's email inbox for a verification email and return the verification link. Call this after signing up when you need to verify your email.",
    {},
  )(async function check_verification_email() {
    console.log("   [Action] Checking inbox for verification email...");
    const msg = await waitForEmail(inbox.inbox_id, knownIds, 90, 2);
    if (msg) {
      const link = extractVerificationLink(msg);
      if (link) {
        console.log("   [Action] Found verification link!");
        return new ActionResult({
          extracted_content: `Verification link found: ${link}`,
        });
      }
      return new ActionResult({
        extracted_content: "Email received but no verification link found in it.",
      });
    }
    return new ActionResult({
      extracted_content: "No verification email received within timeout.",
    });
  });

  const profile = new BrowserProfile({
    headless: false,
    highlight_elements: true,
    allowed_domains: ["*.openrouter.ai", "*.clerk.accounts.dev", "*.accounts.dev"],
  });
  const browserSession = new BrowserSession({ browser_profile: profile });

  const task = `
You are automating the full process of signing up for OpenRouter and getting an API key.

STEP 1 - SIGN UP:
1. Go to https://openrouter.ai/
2. Click "Sign Up" button
3. Use email signup (NOT Google/GitHub OAuth)
4. Email: use the sensitive data 'email'
5. Password: use the sensitive data 'password'
6. Accept terms checkbox if present
7. Click Continue

STEP 2 - VERIFY EMAIL:
8. After you see "Verify your email", use the check_verification_email action to get the verification link
9. Navigate to the verification link URL in the browser
10. Wait for verification to complete

STEP 3 - HANDLE ONBOARDING:
11. After verification, the site may show onboarding modals or surveys (e.g. "How did you hear about us?")
12. For any survey or questionnaire modal: select any option and click Continue/Submit to dismiss it
13. Do NOT just close modals with the X button — fill them out and submit them so they don't reappear

STEP 4 - CREATE API KEY:
14. Navigate to https://openrouter.ai/settings/keys
15. If you're not logged in, sign in with the same email and password
16. Click "Create Key" or similar button
17. Name the key "bip-auto" if asked
18. IMPORTANT: Copy the full API key value displayed. It starts with "sk-or-"
19. Do NOT close any modal showing the key
20. Return ONLY the API key string as your final answer
`;

  const agent = new Agent({
    task,
    llm: getLLM(),
    browser_session: browserSession,
    controller,
    max_actions_per_step: 5,
    use_vision: true,
    sensitive_data: {
      "*.openrouter.ai": { email, password: PASSWORD },
    },
  });

  try {
    const history = await agent.run(50);
    const final = history.final_result();

    if (final) {
      const keyMatch = String(final).match(/sk-or-[a-zA-Z0-9_-]+/);
      if (keyMatch) return keyMatch[0];
      return String(final);
    }
    return null;
  } catch (e) {
    console.error("   Error:", e);
    return null;
  }
}
