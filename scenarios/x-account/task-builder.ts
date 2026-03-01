/**
 * Browser-use task builders for X/Twitter account operations.
 * These return structured prompt strings for callBrowserUseTask().
 */

import {
  X_SIGNUP_CONSTRAINTS,
  X_SIGNUP_STEPS,
  X_SIGNUP_OUTPUT,
  X_POSTING_CONSTRAINTS,
  X_POST_STEPS,
  X_POST_OUTPUT,
} from "./prompts";

export function buildXAccountBootstrapTask(input: {
  profileName: string;
  handle?: string;
  bio?: string;
  agentCredentialInstructions: string;
}): string {
  const handleLine = input.handle
    ? `Requested handle: @${input.handle.replace(/^@/, "")}`
    : "Handle: let X auto-assign or choose something close to the display name.";

  const bioLine = input.bio
    ? `Bio to set: ${input.bio}`
    : "";

  return [
    "[intent=x_account_bootstrap] [provider=x] [domain=x.com]",
    `Goal: Create a new X/Twitter account with display name "${input.profileName}".`,
    handleLine,
    X_SIGNUP_CONSTRAINTS,
    X_SIGNUP_STEPS,
    ...(bioLine ? [`Additional: After account creation, set bio: "${input.bio}"`] : []),
    X_SIGNUP_OUTPUT,
    input.agentCredentialInstructions,
  ].filter(Boolean).join("\n");
}

export function buildXPostTask(input: {
  postText: string;
  imageBase64?: string;
  agentCredentialInstructions: string;
}): string {
  const imageNote = input.imageBase64
    ? "An image has been provided — upload it with the post. The image data will be available in the browser context."
    : "No image to attach — text-only post.";

  return [
    "[intent=x_post] [provider=x] [domain=x.com]",
    "Goal: Post a tweet on X/Twitter.",
    X_POSTING_CONSTRAINTS,
    X_POST_STEPS,
    `Post text:\n---\n${input.postText}\n---`,
    imageNote,
    X_POST_OUTPUT,
    input.agentCredentialInstructions,
  ].join("\n");
}
