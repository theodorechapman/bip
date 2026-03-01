/**
 * Browser Use profile manager.
 *
 * Implements the one-profile-per-account pattern:
 * - Create a profile for each managed account (X, Shopify, etc.)
 * - Log in once, reuse auth across sessions
 * - Refresh stale profiles (>7 days) by re-running login
 * - Store profile IDs in your DB/convex for persistence
 */

import { getBrowserUseClient, runTask } from "./client";
import type { ProfileView } from "./client";

export type AccountProfile = {
  profileId: string;
  name: string;
  platform: string;
  createdAt: string;
  lastUsedAt: string | null;
  cookieDomains: string[];
};

/**
 * Create a new browser profile for an account.
 * Does NOT log in — call loginProfile() after creation.
 */
export async function createProfile(name: string): Promise<AccountProfile> {
  const client = getBrowserUseClient();
  const profile = await client.profiles.create({ name });

  return {
    profileId: profile.id,
    name: profile.name ?? name,
    platform: extractPlatform(name),
    createdAt: profile.createdAt,
    lastUsedAt: profile.lastUsedAt ?? null,
    cookieDomains: profile.cookieDomains ?? [],
  };
}

/**
 * Log in to a platform using the provided profile.
 * This saves auth cookies/state to the profile for future reuse.
 *
 * After this, all sessions using this profileId will be pre-authenticated.
 */
export async function loginProfile(input: {
  profileId: string;
  loginTask: string;
  allowedDomains?: string[];
  proxyCountry?: string;
}): Promise<{ ok: boolean; output?: string; error?: string }> {
  const client = getBrowserUseClient();

  const session = await client.sessions.create({
    profileId: input.profileId,
    proxyCountryCode: (input.proxyCountry ?? "us") as any,
    keepAlive: false,
  });

  try {
    const result = await client.run(input.loginTask, {
      sessionId: session.id,
      allowedDomains: input.allowedDomains,
      timeout: 120_000,
    });

    return {
      ok: result.status === "completed" || result.status === "finished",
      output: result.output ?? undefined,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "login_failed" };
  } finally {
    try {
      await client.sessions.stop(session.id);
    } catch {
      // best-effort — stop triggers profile write-back
    }
  }
}

/**
 * Create a profile and immediately log in.
 * Returns the profile ID on success.
 */
export async function createAndLoginProfile(input: {
  name: string;
  loginTask: string;
  allowedDomains?: string[];
  proxyCountry?: string;
}): Promise<{ ok: boolean; profileId?: string; error?: string }> {
  const profile = await createProfile(input.name);

  const loginResult = await loginProfile({
    profileId: profile.profileId,
    loginTask: input.loginTask,
    allowedDomains: input.allowedDomains,
    proxyCountry: input.proxyCountry,
  });

  if (!loginResult.ok) {
    return { ok: false, error: loginResult.error };
  }

  return { ok: true, profileId: profile.profileId };
}

/**
 * Run a task using an existing profile's auth state.
 * Creates a one-shot session, runs the task, and stops.
 */
export async function runWithProfile(input: {
  profileId: string;
  task: string;
  allowedDomains?: string[];
  proxyCountry?: string;
  timeout?: number;
}): Promise<{ ok: boolean; output?: string; error?: string }> {
  const client = getBrowserUseClient();

  const session = await client.sessions.create({
    profileId: input.profileId,
    proxyCountryCode: (input.proxyCountry ?? "us") as any,
    keepAlive: false,
  });

  try {
    const result = await client.run(input.task, {
      sessionId: session.id,
      allowedDomains: input.allowedDomains,
      timeout: input.timeout ?? 300_000,
    });

    return {
      ok: result.status === "completed" || result.status === "finished",
      output: result.output ?? undefined,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "task_failed" };
  } finally {
    try {
      await client.sessions.stop(session.id);
    } catch {
      // best-effort cleanup
    }
  }
}

/**
 * Check if a profile needs to be refreshed (>7 days since last use).
 */
export function isProfileStale(profile: {
  lastUsedAt: string | null;
}): boolean {
  if (!profile.lastUsedAt) return true;
  const lastUsed = new Date(profile.lastUsedAt).getTime();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  return Date.now() - lastUsed > sevenDaysMs;
}

/**
 * Refresh a stale profile by re-running the login task.
 */
export async function refreshProfile(input: {
  profileId: string;
  loginTask: string;
  allowedDomains?: string[];
}): Promise<{ ok: boolean; error?: string }> {
  return loginProfile(input);
}

/**
 * List all profiles.
 */
export async function listProfiles(): Promise<AccountProfile[]> {
  const client = getBrowserUseClient();
  const response = await client.profiles.list({ pageSize: 100 });

  return response.items.map((p: ProfileView) => ({
    profileId: p.id,
    name: p.name ?? "unnamed",
    platform: extractPlatform(p.name ?? ""),
    createdAt: p.createdAt,
    lastUsedAt: p.lastUsedAt ?? null,
    cookieDomains: p.cookieDomains ?? [],
  }));
}

/**
 * Delete a profile permanently.
 */
export async function deleteProfile(profileId: string): Promise<void> {
  const client = getBrowserUseClient();
  await client.profiles.delete(profileId);
}

/**
 * Get a profile's details.
 */
export async function getProfile(
  profileId: string,
): Promise<AccountProfile | null> {
  const client = getBrowserUseClient();
  try {
    const p = await client.profiles.get(profileId);
    return {
      profileId: p.id,
      name: p.name ?? "unnamed",
      platform: extractPlatform(p.name ?? ""),
      createdAt: p.createdAt,
      lastUsedAt: p.lastUsedAt ?? null,
      cookieDomains: p.cookieDomains ?? [],
    };
  } catch {
    return null;
  }
}

function extractPlatform(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("twitter") || lower.includes("x-")) return "x";
  if (lower.includes("shopify")) return "shopify";
  if (lower.includes("linkedin")) return "linkedin";
  if (lower.includes("instagram")) return "instagram";
  return "other";
}
