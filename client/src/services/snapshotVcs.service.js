import {
  API_BASE,
  authAwareFetch,
  getAccessToken,
  handleUnauthorizedResponse,
} from "../lib/authSession.js";

function baseVcsUrl(projectId) {
  return `${API_BASE}/projects/${encodeURIComponent(projectId)}/snapshot-vcs`;
}

function getAuthHeaders(includeJson = true) {
  const token = getAccessToken();
  return {
    ...(includeJson ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function encodeQuery(params) {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === "") continue;
    search.set(k, String(v));
  }
  const str = search.toString();
  return str ? `?${str}` : "";
}

async function handleResponse(res, fallbackMsg = "Snapshot VCS operation failed") {
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

function vcsFetch(url, options = {}) {
  return authAwareFetch(fetch, url, options);
}

export const snapshotVcsService = {
  getStatus: async (projectId, { includeUnchanged = false } = {}) => {
    const query = encodeQuery(
      includeUnchanged ? { includeUnchanged: "true" } : {},
    );
    const res = await vcsFetch(`${baseVcsUrl(projectId)}/status${query}`, {
      headers: getAuthHeaders(false),
    });
    return handleResponse(res, "Failed to load Snapshot VCS status");
  },

  stageFiles: async (projectId, { files, folder } = {}) => {
    const res = await vcsFetch(`${baseVcsUrl(projectId)}/stage`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        ...(files !== undefined ? { files } : {}),
        ...(folder ? { folder } : {}),
      }),
    });
    return handleResponse(res, "Failed to stage files");
  },

  unstageFiles: async (projectId, { files, folder } = {}) => {
    const res = await vcsFetch(`${baseVcsUrl(projectId)}/unstage`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        ...(files !== undefined ? { files } : {}),
        ...(folder ? { folder } : {}),
      }),
    });
    return handleResponse(res, "Failed to unstage files");
  },

  discardChanges: async (projectId, { files = "all" } = {}) => {
    const res = await vcsFetch(`${baseVcsUrl(projectId)}/discard`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ files }),
    });
    return handleResponse(res, "Failed to discard workspace changes");
  },

  getDiffPair: async (
    projectId,
    { filePath, baseSnapshotId, targetSnapshotId, origPath, signal } = {},
  ) => {
    const query = encodeQuery({
      filePath,
      baseSnapshotId,
      targetSnapshotId,
      origPath,
    });
    const res = await vcsFetch(`${baseVcsUrl(projectId)}/diff-pair${query}`, {
      headers: getAuthHeaders(false),
      ...(signal ? { signal } : {}),
    });
    return handleResponse(res, "Failed to load file diff");
  },

  compareCheckpoints: async (
    projectId,
    { baseSnapshotId, targetSnapshotId = "WORKING_TREE", signal } = {},
  ) => {
    const query = encodeQuery({ baseSnapshotId, targetSnapshotId });
    const res = await vcsFetch(`${baseVcsUrl(projectId)}/compare${query}`, {
      headers: getAuthHeaders(false),
      ...(signal ? { signal } : {}),
    });
    return handleResponse(res, "Failed to compare checkpoints");
  },

  listCheckpoints: async (
    projectId,
    { branchId, search, tag, pinnedOnly, page = 1, limit = 50 } = {},
  ) => {
    const query = encodeQuery({
      branchId,
      search,
      tag,
      ...(pinnedOnly ? { pinnedOnly: "true" } : {}),
      page,
      limit,
    });
    const res = await vcsFetch(`${baseVcsUrl(projectId)}/checkpoints${query}`, {
      headers: getAuthHeaders(false),
    });
    return handleResponse(res, "Failed to list checkpoints");
  },

  captureCheckpoint: async (projectId, payload) => {
    const res = await vcsFetch(`${baseVcsUrl(projectId)}/checkpoints`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(payload || {}),
    });
    return handleResponse(res, "Failed to capture checkpoint");
  },

  updateCheckpoint: async (projectId, snapshotId, payload) => {
    const res = await vcsFetch(
      `${baseVcsUrl(projectId)}/checkpoints/${encodeURIComponent(snapshotId)}`,
      {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify(payload || {}),
      },
    );
    return handleResponse(res, "Failed to update checkpoint");
  },

  deleteCheckpoint: async (projectId, snapshotId) => {
    const res = await vcsFetch(
      `${baseVcsUrl(projectId)}/checkpoints/${encodeURIComponent(snapshotId)}`,
      {
        method: "DELETE",
        headers: getAuthHeaders(false),
      },
    );
    return handleResponse(res, "Failed to delete checkpoint");
  },

  getCheckpointTree: async (projectId, snapshotId) => {
    const res = await vcsFetch(
      `${baseVcsUrl(projectId)}/checkpoints/${encodeURIComponent(snapshotId)}/tree`,
      { headers: getAuthHeaders(false) },
    );
    return handleResponse(res, "Failed to load checkpoint file tree");
  },

  getCheckpointFile: async (projectId, snapshotId, filePath) => {
    const query = encodeQuery({ path: filePath });
    const res = await vcsFetch(
      `${baseVcsUrl(projectId)}/checkpoints/${encodeURIComponent(snapshotId)}/file${query}`,
      { headers: getAuthHeaders(false) },
    );
    return handleResponse(res, "Failed to read checkpoint file");
  },

  restoreSingleFile: async (projectId, snapshotId, filePath) => {
    const res = await vcsFetch(
      `${baseVcsUrl(projectId)}/checkpoints/${encodeURIComponent(snapshotId)}/restore-file`,
      {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ filePath }),
      },
    );
    return handleResponse(res, "Failed to restore file from checkpoint");
  },

  restoreCheckpoint: async (projectId, snapshotId, payload = {}) => {
    const res = await vcsFetch(
      `${baseVcsUrl(projectId)}/checkpoints/${encodeURIComponent(snapshotId)}/restore`,
      {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      },
    );
    return handleResponse(res, "Failed to rollback checkpoint");
  },

  exportCheckpointZip: async (projectId, snapshotId) => {
    const res = await vcsFetch(
      `${baseVcsUrl(projectId)}/checkpoints/${encodeURIComponent(snapshotId)}/export-zip`,
      { headers: getAuthHeaders(false) },
    );
    if (!res.ok) {
      return handleResponse(res, "Failed to export checkpoint ZIP");
    }
    const blob = await res.blob();
    const disposition = res.headers?.get?.("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/i);
    const filename = match?.[1] || `checkpoint-${snapshotId.slice(0, 8)}.zip`;
    if (typeof document !== "undefined" && typeof URL?.createObjectURL === "function") {
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    }
    return { success: true, filename, size: blob.size };
  },

  generateAiSummary: async (projectId, { model } = {}) => {
    const res = await vcsFetch(`${baseVcsUrl(projectId)}/ai-summary`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(model ? { model } : {}),
    });
    return handleResponse(res, "Failed to generate AI checkpoint summary");
  },

  listBranches: async (projectId) => {
    const res = await vcsFetch(`${baseVcsUrl(projectId)}/branches`, {
      headers: getAuthHeaders(false),
    });
    return handleResponse(res, "Failed to list snapshot branches");
  },

  createBranch: async (projectId, payload) => {
    const res = await vcsFetch(`${baseVcsUrl(projectId)}/branches`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(payload || {}),
    });
    return handleResponse(res, "Failed to create branch");
  },

  checkoutBranch: async (projectId, branchId, payload = {}) => {
    const res = await vcsFetch(
      `${baseVcsUrl(projectId)}/branches/${encodeURIComponent(branchId)}/checkout`,
      {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      },
    );
    return handleResponse(res, "Failed to switch branch");
  },

  updateBranch: async (projectId, branchId, payload) => {
    const res = await vcsFetch(
      `${baseVcsUrl(projectId)}/branches/${encodeURIComponent(branchId)}`,
      {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify(payload || {}),
      },
    );
    return handleResponse(res, "Failed to update branch");
  },

  deleteBranch: async (projectId, branchId) => {
    const res = await vcsFetch(
      `${baseVcsUrl(projectId)}/branches/${encodeURIComponent(branchId)}`,
      {
        method: "DELETE",
        headers: getAuthHeaders(false),
      },
    );
    return handleResponse(res, "Failed to delete branch");
  },

  mergeBranch: async (projectId, payload) => {
    const res = await vcsFetch(`${baseVcsUrl(projectId)}/branches/merge`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(payload || {}),
    });
    return handleResponse(res, "Failed to merge branch");
  },

  resolveMergeBranch: async (projectId, payload) => {
    const res = await vcsFetch(
      `${baseVcsUrl(projectId)}/branches/merge/resolve`,
      {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(payload || {}),
      },
    );
    return handleResponse(res, "Failed to resolve snapshot branch merge");
  },

  listTags: async (projectId) => {
    const res = await vcsFetch(`${baseVcsUrl(projectId)}/tags`, {
      headers: getAuthHeaders(false),
    });
    return handleResponse(res, "Failed to list release tags");
  },

  createTag: async (projectId, snapshotId, payload) => {
    const res = await vcsFetch(
      `${baseVcsUrl(projectId)}/checkpoints/${encodeURIComponent(snapshotId)}/tags`,
      {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(payload || {}),
      },
    );
    return handleResponse(res, "Failed to create tag");
  },

  deleteTag: async (projectId, tagId) => {
    const res = await vcsFetch(
      `${baseVcsUrl(projectId)}/tags/${encodeURIComponent(tagId)}`,
      {
        method: "DELETE",
        headers: getAuthHeaders(false),
      },
    );
    return handleResponse(res, "Failed to delete tag");
  },

  runGarbageCollection: async (projectId, { graceWindowMs } = {}) => {
    const res = await vcsFetch(`${baseVcsUrl(projectId)}/gc`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(
        graceWindowMs !== undefined ? { graceWindowMs } : {},
      ),
    });
    return handleResponse(res, "Failed to run CAS garbage collection");
  },
};
