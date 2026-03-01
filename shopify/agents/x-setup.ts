/**
 * X account setup CLI wrapper.
 *
 * Calls provisionXAccount() and persists the result to
 * shopify/config/x-account.json so run-all can auto-load it.
 */

import { provisionXAccount } from "../../scenarios/x-account/provision";
import { resolve, dirname } from "path";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";

const CONFIG_PATH = resolve(dirname(import.meta.dir), "config", "x-account.json");

export type XAccountConfig = {
  profileId: string;
  skillId: string;
  handle?: string;
  email?: string;
  createdAt: string;
};

/**
 * Load saved X account config, or null if none exists.
 */
export function loadXAccountConfig(): XAccountConfig | null {
  try {
    if (!existsSync(CONFIG_PATH)) return null;
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed.profileId || !parsed.skillId) return null;
    return parsed as XAccountConfig;
  } catch {
    return null;
  }
}

/**
 * Run the full X account provisioning and save config.
 */
export async function setupXAccount(opts?: {
  handle?: string;
  existingEmail?: string;
  existingPassword?: string;
}): Promise<void> {
  console.log("\n=== X Account Setup ===\n");

  // check if already configured
  const existing = loadXAccountConfig();
  if (existing) {
    console.log(`existing X account config found:`);
    console.log(`  profile: ${existing.profileId}`);
    console.log(`  skill:   ${existing.skillId}`);
    console.log(`  handle:  ${existing.handle ?? "unknown"}`);
    console.log(`  created: ${existing.createdAt}`);
    console.log(`\nto re-provision, delete shopify/config/x-account.json first.\n`);
    return;
  }

  const result = await provisionXAccount({
    handle: opts?.handle,
    existingEmail: opts?.existingEmail,
    existingPassword: opts?.existingPassword,
  });

  if (!result.ok) {
    console.error(`\nsetup failed: ${result.error}`);
    if (result.profileId) {
      console.log(`  partial state — profileId: ${result.profileId}`);
    }
    process.exit(1);
  }

  // save config
  const config: XAccountConfig = {
    profileId: result.profileId!,
    skillId: result.skillId!,
    handle: result.handle,
    email: result.email,
    createdAt: new Date().toISOString(),
  };

  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");

  console.log(`\n=== X Account Ready ===`);
  console.log(`  profile: ${config.profileId}`);
  console.log(`  skill:   ${config.skillId}`);
  console.log(`  handle:  ${config.handle ?? "unknown"}`);
  console.log(`  email:   ${config.email ?? "unknown"}`);
  console.log(`  config:  ${CONFIG_PATH}`);
  console.log(`\nrun-all will auto-load this config for the promotion stage.\n`);
}
