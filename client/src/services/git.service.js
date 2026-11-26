import {
  API_BASE,
  authAwareFetch,
  getAccessToken,
  handleUnauthorizedResponse,
} from "../lib/authSession.js";

const BASE_URL = API_BASE;

function getAuthHeaders() {
  const token = getAccessToken();
  return {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
  };
}

function gitFetch(url, options = {}) {
  return authAwareFetch(fetch, url, options);
}

async function handleResponse(res, fallbackMsg = "Git operation failed") {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      await handleUnauthorizedResponse();
    }
    const err = new Error(data.error || data.message || fallbackMsg);
    err.status = res.status;
    err.code = data.code || null;
    if (data.details !== undefined) {
      err.details = data.details;
    }
    throw err;
  }
  return data;
}

function encodeQuery(params) {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === "") continue;
    search.set(k, String(v));
  }
  return search.toString();
}

export const gitService = {
  getStatus: async (projectId, { includeTracked = false } = {}) => {
    const query = encodeQuery({
      projectId,
      ...(includeTracked ? { includeTracked: "true" } : {}),
    });
    const res = await gitFetch(`${BASE_URL}/git/status?${query}`, {
      headers: getAuthHeaders(),
    });
    if (res.status === 404) {
      return {
        success: true,
        data: {
          isGitHubProject: false,
          isGitHubLinked: false,
          hasGit: false,
          canInitialize: false,
          isReady: false,
          branch: null,
          headOid: null,
          detached: false,
          tracking: null,
          ahead: 0,
          behind: 0,
          operationState: "IDLE",
          staged: [],
          unstaged: [],
          untracked: [],
          conflicts: [],
          unchangedCount: 0,
          stashCount: 0,
          clean: true,
          repoUrl: null,
          message: "Project not found or repository snapshot not ready.",
        },
      };
    }
    return handleResponse(res, "Failed to load git status");
  },

  initRepo: async (projectId, options = {}) => {
    const res = await gitFetch(`${BASE_URL}/git/init`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, ...options }),
    });
    return handleResponse(res, "Failed to initialize Git repository");
  },

  publishToGitHub: async (projectId, payload) => {
    const res = await gitFetch(`${BASE_URL}/git/publish-github`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, ...payload }),
    });
    return handleResponse(res, "Failed to publish repository to GitHub");
  },

  setRemoteUrl: async (projectId, repoUrl) => {
    const res = await gitFetch(`${BASE_URL}/git/remote`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, repoUrl }),
    });
    return handleResponse(res, "Failed to set remote URL");
  },

  stageFiles: async (projectId, files, folder) => {
    const res = await gitFetch(`${BASE_URL}/git/stage`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        projectId,
        ...(files !== undefined ? { files } : {}),
        ...(folder ? { folder } : {}),
      }),
    });
    return handleResponse(res, "Failed to stage files");
  },

  unstageFiles: async (projectId, files, folder) => {
    const res = await gitFetch(`${BASE_URL}/git/unstage`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        projectId,
        ...(files !== undefined ? { files } : {}),
        ...(folder ? { folder } : {}),
      }),
    });
    return handleResponse(res, "Failed to unstage files");
  },

  stageHunk: async (projectId, filePath, hunkIndex) => {
    const res = await gitFetch(`${BASE_URL}/git/stage-hunk`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, filePath, hunkIndex }),
    });
    return handleResponse(res, "Failed to stage hunk");
  },

  unstageHunk: async (projectId, filePath, hunkIndex) => {
    const res = await gitFetch(`${BASE_URL}/git/unstage-hunk`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, filePath, hunkIndex }),
    });
    return handleResponse(res, "Failed to unstage hunk");
  },

  revertHunk: async (projectId, filePath, hunkIndex) => {
    const res = await gitFetch(`${BASE_URL}/git/revert-hunk`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, filePath, hunkIndex }),
    });
    return handleResponse(res, "Failed to revert hunk");
  },

  discardChanges: async (projectId, filePathOrOptions, isUntracked = false) => {
    const payload =
      filePathOrOptions && typeof filePathOrOptions === "object"
        ? { projectId, ...filePathOrOptions }
        : filePathOrOptions === "all"
          ? {
              projectId,
              files: "all",
              includeUntracked: Boolean(isUntracked),
            }
          : {
              projectId,
              filePath: filePathOrOptions,
              isUntracked: Boolean(isUntracked),
            };
    const res = await gitFetch(`${BASE_URL}/git/discard`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    return handleResponse(res, "Failed to discard changes");
  },

  addGitignore: async (projectId, pattern) => {
    const res = await gitFetch(`${BASE_URL}/git/gitignore`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, pattern }),
    });
    return handleResponse(res, "Failed to update .gitignore");
  },

  getDiff: async (projectId, filePath, staged = false) => {
    const query = encodeQuery({
      projectId,
      filePath: filePath || "",
      staged: staged ? "true" : "false",
    });
    const res = await gitFetch(`${BASE_URL}/git/diff?${query}`, {
      headers: getAuthHeaders(),
    });
    return handleResponse(res, "Failed to get file diff");
  },

  getDiffPair: async (
    projectId,
    { filePath, mode = "working", commitHash, parentHash, origPath } = {},
  ) => {
    const query = encodeQuery({
      projectId,
      filePath,
      mode,
      commitHash,
      parentHash,
      origPath,
    });
    const res = await gitFetch(`${BASE_URL}/git/diff-pair?${query}`, {
      headers: getAuthHeaders(),
    });
    return handleResponse(res, "Failed to load diff pair");
  },

  getFileAtRef: async (projectId, { filePath, ref = "HEAD" } = {}) => {
    const query = encodeQuery({ projectId, filePath, ref });
    const res = await gitFetch(`${BASE_URL}/git/file-at-ref?${query}`, {
      headers: getAuthHeaders(),
    });
    return handleResponse(res, "Failed to read file at ref");
  },

  commit: async (projectId, messageOrOptions) => {
    const payload =
      typeof messageOrOptions === "string"
        ? { projectId, message: messageOrOptions }
        : { projectId, ...(messageOrOptions || {}) };
    const res = await gitFetch(`${BASE_URL}/git/commit`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    return handleResponse(res, "Failed to commit changes");
  },

  undoCommit: async (projectId, { allowPushed = false } = {}) => {
    const res = await gitFetch(`${BASE_URL}/git/undo-commit`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, allowPushed }),
    });
    return handleResponse(res, "Failed to undo commit");
  },

  generateAiCommitMessage: async (projectId, { model } = {}) => {
    const res = await gitFetch(`${BASE_URL}/git/ai-commit-message`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, ...(model ? { model } : {}) }),
    });
    return handleResponse(res, "Failed to generate commit message");
  },

  getLog: async (projectId, limitOrOptions = 30) => {
    const opts =
      typeof limitOrOptions === "number"
        ? { limit: limitOrOptions }
        : limitOrOptions || {};
    const query = encodeQuery({ projectId, ...opts });
    const res = await gitFetch(`${BASE_URL}/git/log?${query}`, {
      headers: getAuthHeaders(),
    });
    return handleResponse(res, "Failed to load commit history");
  },

  getCommitDetail: async (projectId, hash) => {
    const query = encodeQuery({ projectId });
    const res = await gitFetch(
      `${BASE_URL}/git/commits/${encodeURIComponent(hash)}?${query}`,
      { headers: getAuthHeaders() },
    );
    return handleResponse(res, "Failed to inspect commit details");
  },

  revertCommit: async (projectId, hash) => {
    const res = await gitFetch(
      `${BASE_URL}/git/commits/${encodeURIComponent(hash)}/revert`,
      {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ projectId }),
      },
    );
    return handleResponse(res, "Failed to revert commit");
  },

  cherryPickCommit: async (projectId, hash) => {
    const res = await gitFetch(
      `${BASE_URL}/git/commits/${encodeURIComponent(hash)}/cherry-pick`,
      {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ projectId }),
      },
    );
    return handleResponse(res, "Failed to cherry-pick commit");
  },

  reset: async (projectId, { targetRef = "HEAD", mode = "mixed" } = {}) => {
    const res = await gitFetch(`${BASE_URL}/git/reset`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, targetRef, mode }),
    });
    return handleResponse(res, "Failed to reset repository");
  },

  getBranches: async (projectId) => {
    const query = encodeQuery({ projectId });
    const res = await gitFetch(`${BASE_URL}/git/branches?${query}`, {
      headers: getAuthHeaders(),
    });
    return handleResponse(res, "Failed to list branches");
  },

  checkout: async (projectId, branchOrOptions, createNew = false) => {
    const payload =
      typeof branchOrOptions === "string"
        ? { projectId, branch: branchOrOptions, createNew }
        : { projectId, ...(branchOrOptions || {}) };
    const res = await gitFetch(`${BASE_URL}/git/checkout`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    return handleResponse(res, "Failed to checkout branch");
  },

  renameBranch: async (projectId, oldName, newName) => {
    const res = await gitFetch(`${BASE_URL}/git/branches/rename`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, oldName, newName }),
    });
    return handleResponse(res, "Failed to rename branch");
  },

  deleteBranch: async (
    projectId,
    name,
    { force = false, deleteRemote = false } = {},
  ) => {
    const res = await gitFetch(
      `${BASE_URL}/git/branches/${encodeURIComponent(name)}`,
      {
        method: "DELETE",
        headers: getAuthHeaders(),
        body: JSON.stringify({ projectId, force, deleteRemote }),
      },
    );
    return handleResponse(res, "Failed to delete branch");
  },

  merge: async (projectId, sourceBranch, { mode = "merge" } = {}) => {
    const res = await gitFetch(`${BASE_URL}/git/merge`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, sourceBranch, mode }),
    });
    return handleResponse(res, "Failed to merge branch");
  },

  mergeAbort: async (projectId) => {
    const res = await gitFetch(`${BASE_URL}/git/merge/abort`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId }),
    });
    return handleResponse(res, "Failed to abort merge");
  },

  mergeContinue: async (projectId) => {
    const res = await gitFetch(`${BASE_URL}/git/merge/continue`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId }),
    });
    return handleResponse(res, "Failed to complete merge");
  },

  rebase: async (projectId, targetBranch) => {
    const res = await gitFetch(`${BASE_URL}/git/rebase`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, targetBranch }),
    });
    return handleResponse(res, "Failed to rebase branch");
  },

  rebaseAbort: async (projectId) => {
    const res = await gitFetch(`${BASE_URL}/git/rebase/abort`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId }),
    });
    return handleResponse(res, "Failed to abort rebase");
  },

  rebaseContinue: async (projectId) => {
    const res = await gitFetch(`${BASE_URL}/git/rebase/continue`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId }),
    });
    return handleResponse(res, "Failed to continue rebase");
  },

  getConflicts: async (projectId) => {
    const query = encodeQuery({ projectId });
    const res = await gitFetch(`${BASE_URL}/git/conflicts?${query}`, {
      headers: getAuthHeaders(),
    });
    return handleResponse(res, "Failed to load merge conflicts");
  },

  resolveConflict: async (
    projectId,
    { filePath, resolution, manualContent },
  ) => {
    const res = await gitFetch(`${BASE_URL}/git/conflicts/resolve`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, filePath, resolution, manualContent }),
    });
    return handleResponse(res, "Failed to resolve conflict");
  },

  fetch: async (projectId, options = {}) => {
    const res = await gitFetch(`${BASE_URL}/git/fetch`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, ...options }),
    });
    return handleResponse(res, "Failed to fetch from remote");
  },

  pull: async (projectId, branchOrOptions) => {
    const payload =
      typeof branchOrOptions === "string"
        ? { projectId, branch: branchOrOptions }
        : { projectId, ...(branchOrOptions || {}) };
    const res = await gitFetch(`${BASE_URL}/git/pull`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    return handleResponse(res, "Failed to pull from remote");
  },

  push: async (projectId, branchOrOptions) => {
    const payload =
      typeof branchOrOptions === "string"
        ? { projectId, branch: branchOrOptions }
        : { projectId, ...(branchOrOptions || {}) };
    const res = await gitFetch(`${BASE_URL}/git/push`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    return handleResponse(res, "Failed to push to remote");
  },

  sync: async (projectId, options = {}) => {
    const res = await gitFetch(`${BASE_URL}/git/sync`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, ...options }),
    });
    return handleResponse(res, "Failed to sync repository");
  },

  listStashes: async (projectId) => {
    const query = encodeQuery({ projectId });
    const res = await gitFetch(`${BASE_URL}/git/stashes?${query}`, {
      headers: getAuthHeaders(),
    });
    return handleResponse(res, "Failed to load stashes");
  },

  createStash: async (projectId, payload = {}) => {
    const res = await gitFetch(`${BASE_URL}/git/stashes`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, ...payload }),
    });
    return handleResponse(res, "Failed to create stash");
  },

  getStashDiff: async (projectId, index) => {
    const query = encodeQuery({ projectId });
    const res = await gitFetch(
      `${BASE_URL}/git/stashes/${encodeURIComponent(index)}?${query}`,
      { headers: getAuthHeaders() },
    );
    return handleResponse(res, "Failed to load stash diff");
  },

  applyStash: async (projectId, index) => {
    const res = await gitFetch(
      `${BASE_URL}/git/stashes/${encodeURIComponent(index)}/apply`,
      {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ projectId }),
      },
    );
    return handleResponse(res, "Failed to apply stash");
  },

  popStash: async (projectId, index) => {
    const res = await gitFetch(
      `${BASE_URL}/git/stashes/${encodeURIComponent(index)}/pop`,
      {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ projectId }),
      },
    );
    return handleResponse(res, "Failed to pop stash");
  },

  dropStash: async (projectId, index) => {
    const res = await gitFetch(
      `${BASE_URL}/git/stashes/${encodeURIComponent(index)}`,
      {
        method: "DELETE",
        headers: getAuthHeaders(),
        body: JSON.stringify({ projectId }),
      },
    );
    return handleResponse(res, "Failed to drop stash");
  },

  listTags: async (projectId) => {
    const query = encodeQuery({ projectId });
    const res = await gitFetch(`${BASE_URL}/git/tags?${query}`, {
      headers: getAuthHeaders(),
    });
    return handleResponse(res, "Failed to load tags");
  },

  createTag: async (projectId, payload) => {
    const res = await gitFetch(`${BASE_URL}/git/tags`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, ...payload }),
    });
    return handleResponse(res, "Failed to create tag");
  },

  pushTag: async (projectId, name) => {
    const res = await gitFetch(
      `${BASE_URL}/git/tags/${encodeURIComponent(name)}/push`,
      {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ projectId }),
      },
    );
    return handleResponse(res, "Failed to push tag");
  },

  deleteTag: async (projectId, name, { deleteRemote = false } = {}) => {
    const res = await gitFetch(
      `${BASE_URL}/git/tags/${encodeURIComponent(name)}`,
      {
        method: "DELETE",
        headers: getAuthHeaders(),
        body: JSON.stringify({ projectId, deleteRemote }),
      },
    );
    return handleResponse(res, "Failed to delete tag");
  },

  listPullRequests: async (projectId, { state = "open" } = {}) => {
    const query = encodeQuery({ projectId, state });
    const res = await gitFetch(`${BASE_URL}/git/github/pulls?${query}`, {
      headers: getAuthHeaders(),
    });
    return handleResponse(res, "Failed to load Pull Requests");
  },

  createPullRequest: async (projectId, payload) => {
    const res = await gitFetch(`${BASE_URL}/git/github/pulls`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, ...payload }),
    });
    return handleResponse(res, "Failed to create Pull Request");
  },

  getCommitChecks: async (projectId, ref = "HEAD") => {
    const query = encodeQuery({ projectId, ref });
    const res = await gitFetch(`${BASE_URL}/git/github/checks?${query}`, {
      headers: getAuthHeaders(),
    });
    return handleResponse(res, "Failed to load CI checks");
  },

  runCommand: async (projectId, command, args = []) => {
    const res = await gitFetch(`${BASE_URL}/git/command`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, command, args }),
    });
    return handleResponse(res, "Failed to execute git command");
  },
};
