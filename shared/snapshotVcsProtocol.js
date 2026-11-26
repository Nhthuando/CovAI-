/**
 * Single Source of Truth for Mini-GitHub Snapshot & Checkpoints VCS contracts,
 * limits, validation helpers, and Socket.IO event names.
 */

export const SNAPSHOT_CHANGE_STATUS = Object.freeze({
  MODIFIED: "M",
  ADDED: "A",
  DELETED: "D",
  RENAMED: "R",
  UNCHANGED: " ",
});

export const SNAPSHOT_VCS_LIMITS = Object.freeze({
  MAX_LABEL_LENGTH: 120,
  MAX_MESSAGE_LENGTH: 4000,
  MAX_TAG_LENGTH: 48,
  MAX_BRANCH_NAME: 80,
  MAX_DIFF_FILE_BYTES: 1024 * 1024,
  MAX_FILES_PER_CHECKPOINT: 20000,
  DEFAULT_BRANCH: "main",
});

export const SNAPSHOT_RESTORE_POLICIES = Object.freeze({
  AUTO_BACKUP: "AUTO_BACKUP",
  DISCARD_DIRTY: "DISCARD_DIRTY",
  FAIL_IF_DIRTY: "FAIL_IF_DIRTY",
});

export const SNAPSHOT_SOCKET_EVENTS = Object.freeze({
  UPDATED: "snapshot_vcs:updated",
  GC_COMPLETED: "snapshot_vcs:gc_completed",
});

export function validateSnapshotBranchName(name) {
  if (typeof name !== "string") return false;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > SNAPSHOT_VCS_LIMITS.MAX_BRANCH_NAME) {
    return false;
  }
  if (
    trimmed.includes("..") ||
    trimmed.includes("//") ||
    trimmed.endsWith("/") ||
    trimmed.endsWith(".")
  ) {
    return false;
  }
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/.test(trimmed);
}

export function validateSnapshotTagName(name) {
  if (typeof name !== "string") return false;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > SNAPSHOT_VCS_LIMITS.MAX_TAG_LENGTH) {
    return false;
  }
  if (trimmed.includes("..") || trimmed.endsWith(".")) {
    return false;
  }
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/.test(trimmed);
}
