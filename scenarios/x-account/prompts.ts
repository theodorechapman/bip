/**
 * Prompt templates for X/Twitter account operations via browser-use.
 */

export const X_SIGNUP_CONSTRAINTS = [
  "Deterministic constraints:",
  "- Navigate directly to https://x.com only.",
  "- Do NOT use Google/Apple/GitHub OAuth — use email signup.",
  "- Do NOT navigate to agentmail.to — there is no web UI for the inbox.",
  "- Email verification is handled automatically via API after you finish.",
  "- If X asks for phone verification, try to skip it. If you cannot skip, report that phone verification is required.",
  "- Stay on x.com for every step.",
].join("\n");

export const X_POSTING_CONSTRAINTS = [
  "Deterministic constraints:",
  "- Navigate directly to https://x.com only.",
  "- Do NOT use search engines or external sites.",
  "- Stay on x.com for every step.",
  "- If a CAPTCHA or verification appears, attempt to solve it. If blocked, report the issue.",
].join("\n");

export const X_SIGNUP_STEPS = [
  "Execution steps:",
  "1) Navigate to https://x.com/i/flow/signup",
  "2) Select 'Create account' with email (not phone).",
  "3) Enter the display name and email address from the credentials below.",
  "4) Set the date of birth to a valid adult date (e.g., January 1, 1995).",
  "5) Complete signup form — agree to terms.",
  "6) When asked for email verification code, report 'verification_pending' and continue.",
  "7) Set the password from the credentials below.",
  "8) If prompted to set a handle/username, set the requested handle.",
  "9) Skip optional steps (profile photo, bio, interests) unless explicitly provided below.",
  "10) Report the final account handle and setup status.",
].join("\n");

export const X_POST_STEPS = [
  "Execution steps:",
  "1) Navigate to https://x.com/home",
  "2) If not logged in, click 'Sign in' and log in with the credentials below.",
  "3) Click the compose/post button (the 'Post' or '+' button).",
  "4) Enter the post text provided below.",
  "5) If an image is provided, click the image/media upload button and upload it.",
  "6) Click 'Post' to submit.",
  "7) Wait for the post to appear in the timeline.",
  "8) Return the URL of the posted tweet.",
].join("\n");

export const X_SIGNUP_OUTPUT = [
  "Output requirements:",
  "- Return the X handle (e.g., @username) if successfully created.",
  "- Return setup status: 'complete', 'verification_pending', or 'phone_required'.",
  "- If any step failed, report which step and the error.",
].join("\n");

export const X_POST_OUTPUT = [
  "Output requirements:",
  "- Return the full URL of the posted tweet (e.g., https://x.com/username/status/123456).",
  "- If posting failed, report the error and what step it failed on.",
].join("\n");
