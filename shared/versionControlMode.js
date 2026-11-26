/**
 * Single Source of Truth for Version Control mode separation (GitHub vs Email),
 * GitHub OAuth scope parsing, and canonical workspace ignore rules across
 * Client & Server.
 */

export const AUTH_PROVIDERS = Object.freeze({
  GITHUB: "github",
  EMAIL: "email",
});

export const VC_MODES = Object.freeze({
  GIT_GITHUB: "git_github",
  SNAPSHOT_VCS: "snapshot_vcs",
});

export const VCS_IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "coverage",
  ".nyc_output",
  "test-results",
  "playwright-report",
  ".playwright",
  ".covai-temp",
  ".covai-system-test",
  ".covai-collaboration",
  ".covai_journal",
  ".covai_test_versions",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".turbo",
  ".parcel-cache",
  ".cache",
  ".vite",
  "__MACOSX",
]);

export const VCS_IGNORED_FILES = new Set([
  ".DS_Store",
  "Thumbs.db",
  ".covai-checkpoint.json",
]);

export const VCS_IGNORED_PATH_PREFIXES = Object.freeze([
  "cypress/videos",
  "cypress/screenshots",
]);

/**
 * Checks whether a single file or folder name is a secret/credential file
 * that must never be indexed into Snapshot CAS or auto-tracked.
 */
export function isVcsSecretFileName(name) {
  if (typeof name !== "string" || !name) return false;
  const trimmed = name.trim();
  if (!trimmed) return false;
  return (
    /^\.env(?:\.|$)/i.test(trimmed) ||
    /(?:credential|service[-_]?account|secret|private[-_]?key)/i.test(trimmed) ||
    /\.(?:pem|key|p12)$/i.test(trimmed)
  );
}

/**
 * Checks whether a project-relative path belongs to runtime/test-runner
 * artifacts, build caches, or secret files.
 */
export function isVcsIgnoredRelativePath(relativePath) {
  if (typeof relativePath !== "string") return true;
  const normalized = relativePath
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  if (!normalized) return false;

  for (const prefix of VCS_IGNORED_PATH_PREFIXES) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return true;
    }
  }

  const segments = normalized.split("/").filter(Boolean);
  for (const segment of segments) {
    if (VCS_IGNORED_DIRECTORIES.has(segment)) {
      return true;
    }
  }

  const baseName = segments[segments.length - 1] || "";
  if (VCS_IGNORED_FILES.has(baseName) || isVcsSecretFileName(baseName)) {
    return true;
  }

  return false;
}

/**
 * Normalizes an auth provider claim to "github" | "email" | null.
 */
export function normalizeAuthProvider(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === AUTH_PROVIDERS.GITHUB) return AUTH_PROVIDERS.GITHUB;
  if (normalized === AUTH_PROVIDERS.EMAIL || normalized === "local") {
    return AUTH_PROVIDERS.EMAIL;
  }
  return null;
}

/**
 * Resolves the exclusive Version Control workbench mode from the session's
 * authentication provider. Never returns a combined/unified mode.
 */
export function resolveVersionControlMode(authProvider) {
  return normalizeAuthProvider(authProvider) === AUTH_PROVIDERS.GITHUB
    ? VC_MODES.GIT_GITHUB
    : VC_MODES.SNAPSHOT_VCS;
}

export function isGitHubAuthSession(authProvider) {
  return normalizeAuthProvider(authProvider) === AUTH_PROVIDERS.GITHUB;
}

/**
 * Parses GitHub OAuth scopes from either a comma/whitespace-delimited string
 * or an array into a deduplicated lowercase list.
 */
export function parseGithubScopes(rawScopes) {
  const parts = Array.isArray(rawScopes)
    ? rawScopes
    : typeof rawScopes === "string"
      ? rawScopes.split(/[\s,]+/)
      : [];

  const seen = new Set();
  const result = [];
  for (const part of parts) {
    if (typeof part !== "string") continue;
    const clean = part.trim().toLowerCase();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    result.push(clean);
  }
  return result;
}

export function hasGithubRepoWriteScope(scopes) {
  return parseGithubScopes(scopes).includes("repo");
}
