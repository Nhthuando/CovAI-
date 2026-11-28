/**
 * Single Source of Truth for VS Code-grade Git & GitHub Workbench contracts,
 * validation helpers, and Socket.IO event names.
 */

export const GIT_FILE_STATUS = Object.freeze({
  MODIFIED: "M",
  ADDED: "A",
  DELETED: "D",
  RENAMED: "R",
  COPIED: "C",
  UNTRACKED: "U",
  IGNORED: "I",
  CONFLICTED: "!",
  UNCHANGED: " ",
});

export const GIT_CONFLICT_CODES = Object.freeze([
  "DD",
  "AU",
  "UD",
  "UA",
  "DU",
  "AA",
  "UU",
]);

export const GIT_REPO_OPERATION_STATE = Object.freeze({
  IDLE: "IDLE",
  MERGING: "MERGING",
  REBASING: "REBASING",
  CHERRY_PICKING: "CHERRY_PICKING",
  REVERTING: "REVERTING",
});

export const GIT_LIMITS = Object.freeze({
  MAX_DIFF_BYTES: 1024 * 1024,
  MAX_LOG_LIMIT: 200,
  MAX_BRANCH_NAME: 200,
  MAX_COMMIT_MSG: 10000,
  MAX_TAG_NAME: 120,
});

export const GIT_SOCKET_EVENTS = Object.freeze({
  STATUS_UPDATED: "git:status_updated",
  OPERATION_PROGRESS: "git:operation_progress",
  OPERATION_COMPLETED: "git:operation_completed",
});

export const GIT_DEFAULT_IGNORE_ENTRIES = Object.freeze([
  "node_modules/",
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.p12",
  "coverage/",
  ".nyc_output/",
  "test-results/",
  "playwright-report/",
  ".playwright/",
  ".covai-temp/",
  ".covai-system-test/",
  ".covai-collaboration/",
  ".covai_journal/",
  ".covai_test_versions/",
  ".covai-checkpoint.json",
  "dist/",
  "build/",
  ".DS_Store",
  "Thumbs.db",
]);

export function isGitConflictXY(xy) {
  return GIT_CONFLICT_CODES.includes(String(xy || "").toUpperCase());
}

function isValidGitRefName(name, maxLen) {
  if (typeof name !== "string") return false;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > maxLen) return false;
  if (trimmed.startsWith("-") || trimmed.startsWith("/") || trimmed.endsWith("/")) {
    return false;
  }
  if (
    trimmed.includes("..") ||
    trimmed.includes("//") ||
    trimmed.includes("@{") ||
    trimmed.endsWith(".lock") ||
    trimmed.endsWith(".")
  ) {
    return false;
  }
  return /^[\w][\w./-]{0,199}$/.test(trimmed);
}

export function validateGitBranchName(name) {
  return isValidGitRefName(name, GIT_LIMITS.MAX_BRANCH_NAME);
}

export function validateGitTagName(name) {
  return isValidGitRefName(name, GIT_LIMITS.MAX_TAG_NAME);
}

export function validateGithubRepoName(name) {
  if (typeof name !== "string") return false;
  const trimmed = name.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") return false;
  return /^[A-Za-z0-9._-]{1,100}$/.test(trimmed);
}

const toNonNegInt = (value) => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0;
};

/**
 * Computes normalized branch tracking / divergence flags against its remote tracking ref.
 */
export function computeBranchDivergence({
  ahead = 0,
  behind = 0,
  tracking = null,
  detached = false,
  isUnborn = false,
} = {}) {
  const aheadCount = toNonNegInt(ahead);
  const behindCount = toNonNegInt(behind);
  const hasUpstream = Boolean(tracking) && !detached && !isUnborn;

  return {
    ahead: aheadCount,
    behind: behindCount,
    hasUpstream,
    canFastForward: hasUpstream && behindCount > 0 && aheadCount === 0,
    diverged: hasUpstream && behindCount > 0 && aheadCount > 0,
    upToDate: hasUpstream && aheadCount === 0 && behindCount === 0,
  };
}

/**
 * Formats Git CLI-compatible tracking & divergence guidance lines (e.g. after checkout/status/fetch).
 */
export function formatGitTrackingMessage({
  branch: _branch,
  tracking,
  ahead = 0,
  behind = 0,
  detached = false,
  isUnborn = false,
} = {}) {
  if (detached || isUnborn || !tracking) return null;
  const aheadCount = toNonNegInt(ahead);
  const behindCount = toNonNegInt(behind);

  if (behindCount > 0 && aheadCount === 0) {
    const unit = behindCount === 1 ? "commit" : "commits";
    return `Your branch is behind '${tracking}' by ${behindCount} ${unit}, and can be fast-forwarded.\n  (use "git pull" to update your local branch)`;
  }

  if (aheadCount > 0 && behindCount === 0) {
    const unit = aheadCount === 1 ? "commit" : "commits";
    return `Your branch is ahead of '${tracking}' by ${aheadCount} ${unit}.\n  (use "git push" to publish your local commits)`;
  }

  if (aheadCount > 0 && behindCount > 0) {
    return `Your branch and '${tracking}' have diverged,\nand have ${aheadCount} and ${behindCount} different commits each, respectively.\n  (use "git pull" to merge the remote branch into yours)`;
  }

  return `Your branch is up to date with '${tracking}'.`;
}
