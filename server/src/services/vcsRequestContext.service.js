import { AsyncLocalStorage } from "node:async_hooks";

const requestContextStorage = new AsyncLocalStorage();

/**
 * Runs a callback within a request-scoped project authorization/snapshot context
 * so downstream services avoid redundant database round-trips on the same HTTP request.
 */
export function runWithProjectRequestContext(context, fn) {
  if (!context || typeof fn !== "function") {
    return typeof fn === "function" ? fn() : undefined;
  }
  return requestContextStorage.run(context, fn);
}

/**
 * Returns the active request-scoped project context, or `null` outside an HTTP request.
 */
export function getProjectRequestContext() {
  return requestContextStorage.getStore() || null;
}

/**
 * Shallow-updates the active request-scoped context if present.
 */
export function updateProjectRequestContext(patch = {}) {
  const store = requestContextStorage.getStore();
  if (!store || !patch || typeof patch !== "object") return;
  if (patch.projectId && store.projectId && patch.projectId !== store.projectId) {
    return;
  }
  Object.assign(store, patch);
}

/**
 * Clears cached project, snapshot, and branch references on the active request context for `projectId`.
 */
export function invalidateProjectRequestContext(projectId = null) {
  const store = requestContextStorage.getStore();
  if (!store) return;
  if (!projectId || store.projectId === projectId) {
    store.project = null;
    store.activeSnapshot = null;
    store.activeBranch = null;
  }
}
