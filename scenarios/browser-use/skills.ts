/**
 * Browser Use Skills manager for X/Twitter operations.
 *
 * Skills are deterministic API wrappers around browser interactions.
 * Create once ($2), execute repeatedly ($0.02/call) — way cheaper
 * than running a full LLM agent for each tweet.
 *
 * Usage:
 * 1. Call createXPostSkill() once to generate the skill
 * 2. Store the skill ID in your DB
 * 3. Call executeXPostSkill() for each tweet — fast + cheap
 */

import { getBrowserUseClient } from "./client";
import type { SkillResponse, ExecuteSkillResponse } from "./client";

// ── Skill creation ──

/**
 * Create a "post tweet" skill.
 * This costs $2 and takes ~30 seconds to generate.
 * The skill ID should be stored for repeated use.
 */
export async function createXPostSkill(): Promise<{
  skillId: string;
  status: string;
}> {
  const client = getBrowserUseClient();

  const response = await client.skills.create({
    goal: [
      "Post a tweet on X (Twitter).",
      "Parameters:",
      "  - tweetText: string (the tweet content)",
      "  - imageUrl: string or null (optional public URL of image to attach)",
      "Returns: { tweetUrl: string, posted: boolean }",
    ].join("\n"),
    agentPrompt: [
      "Navigate to https://x.com/home.",
      "Wait for the home feed to load.",
      "Click the compose/post button.",
      "Type the tweet text in the compose textarea.",
      "If imageUrl is provided, click the media/image upload button and add the image.",
      "Click the 'Post' button to publish.",
      "Wait for the post to appear.",
      "Extract and return the URL of the new tweet.",
    ].join("\n"),
    title: "Post Tweet to X",
    description: "Posts a tweet to X/Twitter with optional image attachment",
  });

  return { skillId: response.id, status: "generating" };
}

/**
 * Create an "X account signup" skill.
 */
export async function createXSignupSkill(): Promise<{
  skillId: string;
  status: string;
}> {
  const client = getBrowserUseClient();

  const response = await client.skills.create({
    goal: [
      "Create a new X (Twitter) account using email signup.",
      "Parameters:",
      "  - email: string (email address for the account)",
      "  - password: string (password to set)",
      "  - displayName: string (profile display name)",
      "  - handle: string or null (optional preferred handle)",
      "Returns: { handle: string, status: 'complete' | 'verification_pending' | 'phone_required' }",
    ].join("\n"),
    agentPrompt: [
      "Navigate to https://x.com/i/flow/signup.",
      "Select 'Create account' with email (not phone, not OAuth).",
      "Enter the display name and email address.",
      "Set date of birth to January 1, 1995.",
      "Complete the signup form and agree to terms.",
      "When asked for email verification, report 'verification_pending'.",
      "Set the password.",
      "If prompted for a handle, set the requested handle.",
      "Skip optional steps (profile photo, bio, interests).",
      "Report the final account handle.",
    ].join("\n"),
    title: "Create X Account",
    description: "Creates a new X/Twitter account via email signup",
  });

  return { skillId: response.id, status: "generating" };
}

// ── Skill status polling ──

/**
 * Poll a skill until generation is complete.
 * Skills take ~30 seconds to generate.
 */
export async function waitForSkillReady(
  skillId: string,
  options?: { timeoutMs?: number; pollIntervalMs?: number },
): Promise<{ ok: boolean; skill?: SkillResponse; error?: string }> {
  const client = getBrowserUseClient();
  const timeout = options?.timeoutMs ?? 120_000;
  const interval = options?.pollIntervalMs ?? 3_000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const skill = await client.skills.get(skillId);

    if (skill.status === "finished") {
      return { ok: true, skill };
    }
    if (skill.status === "failed" || skill.status === "cancelled" || skill.status === "timed_out") {
      return { ok: false, error: `skill_generation_${skill.status}` };
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  return { ok: false, error: "skill_generation_timeout" };
}

// ── Skill execution ──

/**
 * Execute the X post skill. Costs $0.02 per call.
 *
 * If profileId is provided, creates a session with the profile's auth state
 * so the skill can post as the logged-in user.
 */
export async function executeXPostSkill(input: {
  skillId: string;
  tweetText: string;
  imageUrl?: string;
  profileId?: string;
}): Promise<{
  ok: boolean;
  tweetUrl?: string;
  latencyMs?: number;
  error?: string;
}> {
  const client = getBrowserUseClient();

  // if we have a profile, create a session for auth persistence
  let sessionId: string | undefined;
  if (input.profileId) {
    const session = await client.sessions.create({
      profileId: input.profileId,
      keepAlive: false,
    });
    sessionId = session.id;
  }

  try {
    const result = await client.skills.execute(input.skillId, {
      parameters: {
        tweetText: input.tweetText,
        ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
      },
      ...(sessionId ? { sessionId } : {}),
    });

    if (!result.success) {
      return { ok: false, error: result.error ?? "skill_execution_failed" };
    }

    // parse the result - skill returns { tweetUrl, posted }
    const output = result.result as any;
    return {
      ok: true,
      tweetUrl: output?.tweetUrl ?? undefined,
      latencyMs: result.latencyMs ?? undefined,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "skill_execution_error" };
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

/**
 * Execute the X signup skill.
 */
export async function executeXSignupSkill(input: {
  skillId: string;
  email: string;
  password: string;
  displayName: string;
  handle?: string;
  profileId?: string;
}): Promise<{
  ok: boolean;
  handle?: string;
  status?: string;
  error?: string;
}> {
  const client = getBrowserUseClient();

  let sessionId: string | undefined;
  if (input.profileId) {
    const session = await client.sessions.create({
      profileId: input.profileId,
      keepAlive: false,
    });
    sessionId = session.id;
  }

  try {
    const result = await client.skills.execute(input.skillId, {
      parameters: {
        email: input.email,
        password: input.password,
        displayName: input.displayName,
        ...(input.handle ? { handle: input.handle } : {}),
      },
      ...(sessionId ? { sessionId } : {}),
    });

    if (!result.success) {
      return { ok: false, error: result.error ?? "signup_skill_failed" };
    }

    const output = result.result as any;
    return {
      ok: true,
      handle: output?.handle ?? undefined,
      status: output?.status ?? "unknown",
    };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "signup_skill_error" };
  } finally {
    if (sessionId) {
      try {
        await client.sessions.stop(sessionId);
      } catch {}
    }
  }
}

// ── Skill management ──

/**
 * Refine a skill based on feedback (free).
 */
export async function refineSkill(
  skillId: string,
  feedback: string,
): Promise<{ ok: boolean; error?: string }> {
  const client = getBrowserUseClient();
  try {
    await client.skills.refine(skillId, { feedback });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "refine_failed" };
  }
}

/**
 * Rollback a skill to the previous version.
 */
export async function rollbackSkill(
  skillId: string,
): Promise<{ ok: boolean; error?: string }> {
  const client = getBrowserUseClient();
  try {
    await client.skills.rollback(skillId);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "rollback_failed" };
  }
}

/**
 * Get skill details including status and version.
 */
export async function getSkill(
  skillId: string,
): Promise<SkillResponse | null> {
  const client = getBrowserUseClient();
  try {
    return await client.skills.get(skillId);
  } catch {
    return null;
  }
}

/**
 * List all owned skills, optionally filtered by category.
 */
export async function listSkills(
  category?: string,
): Promise<SkillResponse[]> {
  const client = getBrowserUseClient();
  const response = await client.skills.list({
    pageSize: 100,
    ...(category ? { category } : {}),
  });
  return response.items;
}

/**
 * Search the marketplace for existing skills.
 */
export async function searchMarketplaceSkills(
  query: string,
  category?: string,
): Promise<any[]> {
  const client = getBrowserUseClient();
  const response = await client.marketplace.list({
    query,
    pageSize: 20,
    ...(category ? { category } : {}),
  });
  return response.items;
}

/**
 * Clone a marketplace skill to your project.
 */
export async function cloneMarketplaceSkill(
  skillId: string,
): Promise<{ skillId: string }> {
  const client = getBrowserUseClient();
  const cloned = await client.marketplace.clone(skillId);
  return { skillId: cloned.id };
}
