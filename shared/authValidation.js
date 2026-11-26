/**
 * Single Source of Truth for authentication validation, lockout limits,
 * canonical error codes, and user-facing messages across Client & Server.
 */

export const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isValidEmail(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 254) return false;
  return EMAIL_REGEX.test(normalized);
}

export const AUTH_LIMITS = Object.freeze({
  MAX_FAILED_LOGIN_ATTEMPTS: 5,
  ACCOUNT_LOCKOUT_MINUTES: 15,
  ACCOUNT_LOCKOUT_MS: 15 * 60 * 1000,
  GITHUB_PENDING_LINK_TTL_MS: 10 * 60 * 1000,
  OAUTH_STATE_TTL_MS: 10 * 60 * 1000,
});

export const AUTH_ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  OAUTH_ONLY_ACCOUNT: "OAUTH_ONLY_ACCOUNT",
  GITHUB_LINK_CONFIRMATION_REQUIRED: "GITHUB_LINK_CONFIRMATION_REQUIRED",
  INVALID_LINK_PASSWORD: "INVALID_LINK_PASSWORD",
  INVALID_LINK_TOKEN: "INVALID_LINK_TOKEN",
  EMAIL_ALREADY_LINKED_TO_OTHER_GITHUB: "EMAIL_ALREADY_LINKED_TO_OTHER_GITHUB",
  INVALID_OAUTH_STATE: "INVALID_OAUTH_STATE",
  OAUTH_ACCESS_DENIED: "OAUTH_ACCESS_DENIED",
  OAUTH_PROVIDER_ERROR: "OAUTH_PROVIDER_ERROR",
  GITHUB_EMAIL_UNVERIFIED: "GITHUB_EMAIL_UNVERIFIED",
  GITHUB_PROFILE_FAILED: "GITHUB_PROFILE_FAILED",
  ENCRYPTION_CONFIG_ERROR: "ENCRYPTION_CONFIG_ERROR",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  ACCOUNT_EXISTS: "ACCOUNT_EXISTS",
  AUTH_PROVIDER_MISMATCH: "AUTH_PROVIDER_MISMATCH",
  GITHUB_REPO_SCOPE_REQUIRED: "GITHUB_REPO_SCOPE_REQUIRED",
  GITHUB_TOKEN_REVOKED: "GITHUB_TOKEN_REVOKED",
});

export const AUTH_MESSAGES = Object.freeze({
  EMAIL_REQUIRED: "Email is required",
  EMAIL_INVALID: "Please enter a valid email address",
  PASSWORD_REQUIRED: "Password is required",
  PASSWORD_MIN_LENGTH: "Password must be at least 8 characters",
  FULL_NAME_REQUIRED: "Full name is required",
  FULL_NAME_MAX_LENGTH: "Name must not exceed 100 characters",
  PASSWORDS_DO_NOT_MATCH: "Passwords do not match",
  INVALID_CREDENTIALS: "Incorrect email or password",
  ACCOUNT_LOCKED:
    "Too many failed login attempts. Your account is temporarily locked for 15 minutes. Please try again later.",
  OAUTH_ONLY_ACCOUNT:
    "This account is linked with GitHub. Please sign in with GitHub or use 'Forgot password?' to set a local password.",
  INVALID_LINK_PASSWORD:
    "Incorrect password. Please enter the local password for your existing CovAI account.",
  INVALID_LINK_TOKEN:
    "This linking request has expired or is no longer valid. Please sign in with GitHub again.",
  INVALID_OAUTH_STATE:
    "Invalid or expired OAuth session state. Please try signing in with GitHub again.",
  OAUTH_ACCESS_DENIED:
    "GitHub sign-in was cancelled. You can try again or sign in with email and password.",
  GITHUB_EMAIL_UNVERIFIED:
    "Your GitHub account does not have a verified email address. Please verify an email on GitHub and try again.",
  EMAIL_ALREADY_LINKED_TO_OTHER_GITHUB:
    "This email is already linked to a different GitHub account.",
  AUTH_PROVIDER_MISMATCH_GITHUB:
    "Git & GitHub Repository requires signing in with a GitHub account.",
  AUTH_PROVIDER_MISMATCH_EMAIL:
    "Snapshots & Checkpoints Version Control is dedicated to personal email accounts.",
  GITHUB_REPO_SCOPE_REQUIRED:
    "Repository write permission ('repo' scope) is required to push or manage GitHub repositories. Please authorize repository access.",
  GITHUB_TOKEN_REVOKED:
    "Your GitHub access token has expired or been revoked. Please reconnect GitHub.",
});

export function formatLockoutMessage(retryAfterSeconds) {
  if (
    typeof retryAfterSeconds !== "number" ||
    !Number.isFinite(retryAfterSeconds) ||
    retryAfterSeconds <= 0
  ) {
    return AUTH_MESSAGES.ACCOUNT_LOCKED;
  }
  const minutes = Math.ceil(retryAfterSeconds / 60);
  if (minutes <= 1) {
    return "Your account is temporarily locked due to too many failed login attempts. Please try again in 1 minute.";
  }
  return `Your account is temporarily locked due to too many failed login attempts. Please try again in ${minutes} minutes.`;
}
