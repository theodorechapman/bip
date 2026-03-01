/**
 * X account auto-provisioning orchestrator.
 *
 * Chains together existing modules to go from zero to a ready-to-post
 * X account with a browser-use profile + skill:
 *
 * 1. Create browser-use profile
 * 2. Create agentmail inbox (for email verification)
 * 3. Run X signup (or login) task on the profile
 * 4. Poll for verification email, enter code if needed
 * 5. Create X post skill + wait for it to be ready
 * 6. Return { profileId, skillId, handle, email }
 */

import { createProfile, loginProfile, runWithProfile } from "../browser-use/profiles";
import { createXPostSkill, waitForSkillReady } from "../browser-use/skills";
import {
  createOrReuseInbox,
  getExistingMessageIds,
  waitForEmail,
  extractVerificationLink,
} from "../../src/agentmail-client";
import { buildXAccountBootstrapTask } from "./task-builder";

export type ProvisionResult = {
  ok: boolean;
  profileId?: string;
  skillId?: string;
  handle?: string;
  email?: string;
  error?: string;
};

/**
 * Provision a fully-ready X account for automated posting.
 *
 * If existingEmail/existingPassword are provided, skips signup and
 * just logs into the existing account on a fresh profile.
 */
export async function provisionXAccount(opts?: {
  handle?: string;
  bio?: string;
  existingEmail?: string;
  existingPassword?: string;
}): Promise<ProvisionResult> {
  try {
    // ── step 1: create browser-use profile ──
    console.log("[x-provision] step 1/5: creating browser-use profile...");
    const profile = await createProfile("x-dropship-agent");
    const profileId = profile.profileId;
    console.log(`[x-provision] profile created: ${profileId}`);

    let email: string;
    let password: string;
    let handle: string | undefined = opts?.handle;

    if (opts?.existingEmail && opts?.existingPassword) {
      // ── existing account: just login ──
      email = opts.existingEmail;
      password = opts.existingPassword;

      console.log("[x-provision] step 2/5: skipping inbox (existing account)");
      console.log("[x-provision] step 3/5: logging into existing X account...");

      const loginTask = [
        "[intent=x_login] [provider=x] [domain=x.com]",
        `Goal: Log into X/Twitter with the following credentials.`,
        `Email: ${email}`,
        `Password: ${password}`,
        "Steps:",
        "1) Navigate to https://x.com/i/flow/login",
        "2) Enter the email address.",
        "3) Enter the password.",
        "4) Complete any 2FA or verification if prompted.",
        "5) Confirm you are logged in by checking the home feed loads.",
        "6) Report the account handle.",
      ].join("\n");

      const loginResult = await loginProfile({
        profileId,
        loginTask,
        allowedDomains: ["x.com", "twitter.com"],
      });

      if (!loginResult.ok) {
        return { ok: false, profileId, error: `login_failed: ${loginResult.error}` };
      }

      // try to extract handle from output
      if (loginResult.output) {
        const handleMatch = loginResult.output.match(/@(\w+)/);
        if (handleMatch) handle = handleMatch[1];
      }

      console.log(`[x-provision] logged in${handle ? ` as @${handle}` : ""}`);
      console.log("[x-provision] step 4/5: skipping verification (existing account)");
    } else {
      // ── new account: signup + verification ──

      // step 2: create agentmail inbox
      console.log("[x-provision] step 2/5: creating agentmail inbox...");
      const inbox = await createOrReuseInbox(true);
      email = inbox.email;
      password = generatePassword();
      console.log(`[x-provision] inbox ready: ${email}`);

      // step 3: run X signup task
      console.log("[x-provision] step 3/5: running X signup task...");

      const signupTask = buildXAccountBootstrapTask({
        profileName: opts?.handle ?? "BipAgent",
        handle: opts?.handle,
        bio: opts?.bio,
        agentCredentialInstructions: [
          "Credentials to use:",
          `  Email: ${email}`,
          `  Password: ${password}`,
          `  Display name: ${opts?.handle ?? "Bip Agent"}`,
        ].join("\n"),
      });

      const knownIds = await getExistingMessageIds(inbox.inbox_id);

      const signupResult = await loginProfile({
        profileId,
        loginTask: signupTask,
        allowedDomains: ["x.com", "twitter.com"],
      });

      if (!signupResult.ok) {
        return { ok: false, profileId, email, error: `signup_failed: ${signupResult.error}` };
      }

      // try to extract handle from output
      if (signupResult.output) {
        const handleMatch = signupResult.output.match(/@(\w+)/);
        if (handleMatch) handle = handleMatch[1];
      }

      console.log(`[x-provision] signup task done${handle ? ` — handle: @${handle}` : ""}`);

      // step 4: email verification
      console.log("[x-provision] step 4/5: polling for verification email...");
      const verifyEmail = await waitForEmail(inbox.inbox_id, knownIds, 120, 5);

      if (verifyEmail) {
        const link = extractVerificationLink(verifyEmail);

        if (link) {
          // check if it's a code (6 digits) or a link
          const codeMatch = link.match(/\b(\d{5,8})\b/);

          if (codeMatch) {
            // it's a verification code — run a follow-up task to enter it
            console.log(`[x-provision] found verification code: ${codeMatch[1]}`);

            const codeTask = [
              "[intent=x_verify] [provider=x] [domain=x.com]",
              `Goal: Enter the email verification code on X/Twitter.`,
              `Code: ${codeMatch[1]}`,
              "Steps:",
              "1) If there's a verification code input visible, enter the code.",
              "2) If not visible, navigate to https://x.com and look for verification prompts.",
              "3) Enter the code and confirm.",
              "4) Report success or failure.",
            ].join("\n");

            const codeResult = await runWithProfile({
              profileId,
              task: codeTask,
              allowedDomains: ["x.com", "twitter.com"],
              timeout: 60_000,
            });

            if (codeResult.ok) {
              console.log("[x-provision] verification code entered successfully");
            } else {
              console.warn(`[x-provision] code entry may have failed: ${codeResult.error}`);
            }
          } else {
            // it's a verification link — run a follow-up task to click it
            console.log(`[x-provision] found verification link`);

            const linkTask = [
              "[intent=x_verify] [provider=x] [domain=x.com]",
              `Goal: Complete email verification by visiting this link.`,
              `Link: ${link}`,
              "Steps:",
              "1) Navigate to the verification link.",
              "2) Wait for verification to complete.",
              "3) Report success or failure.",
            ].join("\n");

            const linkResult = await runWithProfile({
              profileId,
              task: linkTask,
              allowedDomains: ["x.com", "twitter.com"],
              timeout: 60_000,
            });

            if (linkResult.ok) {
              console.log("[x-provision] verification link completed");
            } else {
              console.warn(`[x-provision] link verification may have failed: ${linkResult.error}`);
            }
          }
        } else {
          console.warn("[x-provision] got verification email but couldn't extract link/code");
        }
      } else {
        console.warn("[x-provision] no verification email received — account may need manual verification");
      }
    }

    // ── step 5: create X post skill ──
    console.log("[x-provision] step 5/5: creating X post skill...");
    const { skillId } = await createXPostSkill();
    console.log(`[x-provision] skill created: ${skillId}, waiting for generation...`);

    const skillReady = await waitForSkillReady(skillId, { timeoutMs: 120_000 });
    if (!skillReady.ok) {
      return {
        ok: false,
        profileId,
        skillId,
        handle,
        email,
        error: `skill_generation_failed: ${skillReady.error}`,
      };
    }

    console.log("[x-provision] skill ready");

    return {
      ok: true,
      profileId,
      skillId,
      handle,
      email,
    };
  } catch (err: any) {
    console.error("[x-provision] fatal error:", err?.message);
    return { ok: false, error: err?.message ?? "unknown_error" };
  }
}

/**
 * Generate a random password for new X accounts.
 */
function generatePassword(): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%";
  let pwd = "";
  for (let i = 0; i < 16; i++) {
    pwd += chars[Math.floor(Math.random() * chars.length)];
  }
  return pwd;
}
