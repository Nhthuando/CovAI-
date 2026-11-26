import fs from "node:fs";
import path from "node:path";
import { ServiceError } from "../utils/serviceError.js";

const projectQueues = new Map();
const DEFAULT_LOCK_TIMEOUT_MS = 60_000;

/**
 * Serializes mutating Version Control operations per projectId so concurrent
 * requests cannot collide on `.git/index.lock` or interleave CAS updates.
 * Fails cleanly with `409 VCS_LOCK_TIMEOUT` if the lock cannot be acquired within `timeoutMs`.
 */
export async function withProjectVcsLock(
  projectId,
  fn,
  { timeoutMs = DEFAULT_LOCK_TIMEOUT_MS } = {},
) {
  if (!projectId || typeof fn !== "function") {
    return typeof fn === "function" ? fn() : undefined;
  }

  const key = String(projectId);
  const prevTail = projectQueues.get(key) || Promise.resolve();

  let releaseCurrent;
  const currentGate = new Promise((resolve) => {
    releaseCurrent = resolve;
  });

  const nextTail = prevTail.then(() => currentGate, () => currentGate);
  projectQueues.set(key, nextTail);

  const safeTimeoutMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_LOCK_TIMEOUT_MS;

  let timedOut = false;
  let timer = null;

  try {
    await Promise.race([
      prevTail,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(
            new ServiceError(
              "Another version control operation is currently running on this project. Please retry shortly.",
              409,
              "VCS_LOCK_TIMEOUT",
            ),
          );
        }, safeTimeoutMs);
        timer.unref?.();
      }),
    ]);
  } catch (err) {
    if (timer) clearTimeout(timer);
    if (timedOut) {
      releaseCurrent();
      if (projectQueues.get(key) === nextTail) {
        projectQueues.delete(key);
      }
    }
    throw err;
  }

  if (timer) clearTimeout(timer);

  try {
    return await fn();
  } finally {
    releaseCurrent();
    if (projectQueues.get(key) === nextTail) {
      projectQueues.delete(key);
    }
  }
}

/**
 * Checks for `.git/index.lock` inside a prepared or local repository directory.
 * Removes stale orphaned locks older than `maxAgeMs` only when `removeStale` is true.
 */
export function checkStaleGitIndexLock(
  rootDir,
  { maxAgeMs = 120_000, removeStale = false } = {},
) {
  if (!rootDir) return { locked: false, removedStale: false };
  const lockPath = path.join(rootDir, ".git", "index.lock");
  if (!fs.existsSync(lockPath)) {
    return { locked: false, removedStale: false };
  }

  let ageMs = 0;
  try {
    const stat = fs.statSync(lockPath);
    ageMs = Date.now() - stat.mtimeMs;
  } catch (err) {
    if (err?.code === "ENOENT") return { locked: false, removedStale: false };
    throw err;
  }

  if (removeStale && ageMs >= maxAgeMs) {
    try {
      fs.unlinkSync(lockPath);
      console.warn(
        `[vcsLock] Removed orphaned stale Git index lock (${Math.round(ageMs / 1000)}s old): ${lockPath}`,
      );
      return { locked: false, removedStale: true };
    } catch (err) {
      if (err?.code === "ENOENT") return { locked: false, removedStale: false };
    }
  }

  throw Object.assign(
    new ServiceError(
      "Git repository is currently locked by another operation (.git/index.lock). Please wait a moment and retry.",
      409,
    ),
    { code: "GIT_INDEX_LOCKED" },
  );
}
