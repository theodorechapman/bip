/**
 * Browser Use SDK client wrapper.
 *
 * Provides a singleton-ish client for the Browser Use Cloud API.
 * Uses the official browser-use-sdk package (v3.1.0+).
 *
 * The client auto-reads BROWSER_USE_API_KEY from env (Bun loads .env).
 */

import { BrowserUse } from "browser-use-sdk";
import type {
  ProfileView,
  SessionItemView,
  SkillResponse,
  ExecuteSkillResponse,
  TaskResult,
  CreateSkillRequest,
  ExecuteSkillRequest,
  RefineSkillRequest,
} from "browser-use-sdk";

// re-export useful types
export type {
  ProfileView,
  SessionItemView,
  SkillResponse,
  ExecuteSkillResponse,
  TaskResult,
  CreateSkillRequest,
  ExecuteSkillRequest,
  RefineSkillRequest,
};

let _client: BrowserUse | null = null;

/**
 * Get or create the Browser Use client singleton.
 * Throws if BROWSER_USE_API_KEY is not set.
 */
export function getBrowserUseClient(): BrowserUse {
  if (_client) return _client;

  const apiKey = process.env.BROWSER_USE_API_KEY;
  if (!apiKey) {
    throw new Error("BROWSER_USE_API_KEY is not set");
  }

  _client = new BrowserUse({
    apiKey,
    baseUrl: process.env.BROWSER_USE_API_BASE || undefined,
    maxRetries: 3,
    timeout: 30_000,
  });

  return _client;
}

/**
 * Run a task via the SDK. This replaces the manual fetch + poll pattern.
 * Returns a typed TaskResult with the output.
 */
export async function runTask(
  task: string,
  options?: {
    sessionId?: string;
    profileId?: string;
    allowedDomains?: string[];
    timeout?: number;
  },
): Promise<TaskResult> {
  const client = getBrowserUseClient();

  // if profileId is provided but no sessionId, create a session
  let sessionId = options?.sessionId;
  let createdSession = false;

  if (options?.profileId && !sessionId) {
    const session = await client.sessions.create({
      profileId: options.profileId,
      keepAlive: false,
    });
    sessionId = session.id;
    createdSession = true;
  }

  try {
    const result = await client.run(task, {
      sessionId,
      allowedDomains: options?.allowedDomains,
      timeout: options?.timeout ?? 300_000,
    });

    return result;
  } finally {
    // stop the session if we created it (triggers profile write-back)
    if (createdSession && sessionId) {
      try {
        await client.sessions.stop(sessionId);
      } catch {
        // best-effort cleanup
      }
    }
  }
}
