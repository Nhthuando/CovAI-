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

async function handleResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      await handleUnauthorizedResponse();
    }
    throw new Error(data.error || data.message || "Git operation failed");
  }
  return data;
}

export const gitService = {
  getStatus: async (projectId) => {
    try {
      const res = await gitFetch(`${BASE_URL}/git/status?projectId=${projectId}`, {
        headers: getAuthHeaders(),
      });
      if (res.status === 404) {
        return {
          success: true,
          data: {
            isGitHubProject: false,
            hasGit: false,
            isReady: false,
            branch: null,
            tracking: null,
            ahead: 0,
            behind: 0,
            staged: [],
            unstaged: [],
            untracked: [],
            clean: true,
            repoUrl: null,
            message: "Project not found or repository snapshot not ready.",
          },
        };
      }
      return handleResponse(res);
    } catch (err) {
      return {
        success: true,
        data: {
          isGitHubProject: false,
          hasGit: false,
          isReady: false,
          branch: null,
          tracking: null,
          ahead: 0,
          behind: 0,
          staged: [],
          unstaged: [],
          untracked: [],
          clean: true,
          repoUrl: null,
          message: err.message || "Failed to load git status",
        },
      };
    }
  },

  stageFiles: async (projectId, files) => {
    const res = await gitFetch(`${BASE_URL}/git/stage`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, files }),
    });
    return handleResponse(res);
  },

  unstageFiles: async (projectId, files) => {
    const res = await gitFetch(`${BASE_URL}/git/unstage`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, files }),
    });
    return handleResponse(res);
  },

  discardChanges: async (projectId, filePath, isUntracked = false) => {
    const res = await gitFetch(`${BASE_URL}/git/discard`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, filePath, isUntracked }),
    });
    return handleResponse(res);
  },

  commit: async (projectId, message) => {
    const res = await gitFetch(`${BASE_URL}/git/commit`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, message }),
    });
    return handleResponse(res);
  },

  push: async (projectId, branch) => {
    const res = await gitFetch(`${BASE_URL}/git/push`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, branch }),
    });
    return handleResponse(res);
  },

  pull: async (projectId, branch) => {
    const res = await gitFetch(`${BASE_URL}/git/pull`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, branch }),
    });
    return handleResponse(res);
  },

  getBranches: async (projectId) => {
    const res = await gitFetch(`${BASE_URL}/git/branches?projectId=${projectId}`, {
      headers: getAuthHeaders(),
    });
    return handleResponse(res);
  },

  checkout: async (projectId, branch, createNew = false) => {
    const res = await gitFetch(`${BASE_URL}/git/checkout`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, branch, createNew }),
    });
    return handleResponse(res);
  },

  getLog: async (projectId, limit = 25) => {
    const res = await gitFetch(
      `${BASE_URL}/git/log?projectId=${projectId}&limit=${limit}`,
      {
        headers: getAuthHeaders(),
      },
    );
    return handleResponse(res);
  },

  getDiff: async (projectId, filePath, staged = false) => {
    const res = await gitFetch(
      `${BASE_URL}/git/diff?projectId=${projectId}&filePath=${encodeURIComponent(
        filePath || "",
      )}&staged=${staged}`,
      {
        headers: getAuthHeaders(),
      },
    );
    return handleResponse(res);
  },

  initRepo: async (projectId) => {
    const res = await gitFetch(`${BASE_URL}/git/init`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId }),
    });
    return handleResponse(res);
  },

  setRemoteUrl: async (projectId, repoUrl) => {
    const res = await gitFetch(`${BASE_URL}/git/remote`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, repoUrl }),
    });
    return handleResponse(res);
  },

  runCommand: async (projectId, command, args = []) => {
    const res = await gitFetch(`${BASE_URL}/git/command`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ projectId, command, args }),
    });
    return handleResponse(res);
  },
};
