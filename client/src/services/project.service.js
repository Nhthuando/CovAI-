import { editorAwareFetch } from "./editorAwareRequest";
import { getAIModelHeaders } from "./aiModel.service.js";
const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

function getAuthHeaders() {
  const token = localStorage.getItem("token");
  return {
    "Content-Type": "application/json",
    ...getAIModelHeaders(),
    ...(token && { Authorization: `Bearer ${token}` }),
  };
}

async function handleResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("userName");
      localStorage.removeItem("userEmail");
      window.location.href = "/login";
    }
    const err = new Error(data.message || "Failed API call");
    err.status = res.status;
    err.code = data.code;
    err.resetAt = data.resetAt;
    err.retryAt = data.retryAt;
    err.model = data.model;
    err.details = data.details;
    throw err;
  }
  return data;
}

export async function createProjectApi({ name, description, repoUrl }) {
  const res = await editorAwareFetch(`${BASE_URL}/projects`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ name, description, repoUrl }),
  });
  return handleResponse(res);
}

export async function getProjectsApi() {
  const res = await editorAwareFetch(`${BASE_URL}/projects`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function deleteProjectApi(projectId) {
  const res = await editorAwareFetch(`${BASE_URL}/projects/${projectId}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function getProjectTreeApi(projectId) {
  const res = await editorAwareFetch(`${BASE_URL}/projects/${projectId}/tree`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function validateArchiveApi(file) {
  const token = localStorage.getItem("token");
  const formData = new FormData();
  formData.append("file", file);

  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await editorAwareFetch(`${BASE_URL}/projects/validate-archive`, {
    method: "POST",
    headers,
    body: formData,
  });
  return handleResponse(res);
}

export async function uploadZipApi(projectId, file) {
  const token = localStorage.getItem("token");
  const formData = new FormData();
  formData.append("file", file);
  formData.append("projectId", projectId);

  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await editorAwareFetch(
    `${BASE_URL}/projects/${projectId}/upload-zip`,
    {
      method: "POST",
      headers,
      body: formData,
    },
  );
  return handleResponse(res);
}

export async function importGithubUrlApi(projectId, url) {
  const res = await editorAwareFetch(
    `${BASE_URL}/github/projects/${projectId}/import-github-url`,
    {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ url }),
    },
  );
  return handleResponse(res);
}

export async function importGithubRepoApi(projectId, owner, repo) {
  const res = await editorAwareFetch(
    `${BASE_URL}/github/projects/${projectId}/import-github-repo`,
    {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ owner, repo }),
    },
  );
  return handleResponse(res);
}

export async function getGithubRepositoriesApi() {
  try {
    const res = await editorAwareFetch(`${BASE_URL}/auth/github/repositories`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      return [];
    }
    return handleResponse(res);
  } catch (err) {
    console.warn("[getGithubRepositoriesApi]", err);
    return [];
  }
}

// --- In-Memory & Session Storage Cache for File Contents ---
const fileContentCache = new Map();
const CACHE_PREFIX = "covai_file_cache_";

function makeCacheKey(projectId, filePath, snapshotId) {
  const normPath = (filePath || "").replace(/\\/g, "/");
  return `${projectId}:${snapshotId || "latest"}:${normPath}`;
}

export function getFileContentFromCache(projectId, filePath, snapshotId = "") {
  if (!projectId || !filePath) return null;
  const key = makeCacheKey(projectId, filePath, snapshotId);
  if (fileContentCache.has(key)) {
    return fileContentCache.get(key);
  }
  try {
    const raw = sessionStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      fileContentCache.set(key, parsed);
      return parsed;
    }
  } catch (_) {}
  return null;
}

export function setFileContentToCache(
  projectId,
  filePath,
  data,
  snapshotId = "",
) {
  if (!projectId || !filePath || !data) return;
  const key = makeCacheKey(projectId, filePath, snapshotId);
  fileContentCache.set(key, data);
  try {
    if (typeof data.content === "string" && data.content.length < 500000) {
      sessionStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(data));
    }
  } catch (_) {}
}

export function invalidateFileContentCache(projectId, filePath = null) {
  if (!projectId) return;
  if (!filePath) {
    for (const key of fileContentCache.keys()) {
      if (key.startsWith(`${projectId}:`)) fileContentCache.delete(key);
    }
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(`${CACHE_PREFIX}${projectId}:`))
          sessionStorage.removeItem(k);
      }
    } catch (_) {}
    return;
  }
  const normPath = filePath.replace(/\\/g, "/");
  for (const key of fileContentCache.keys()) {
    if (
      key.startsWith(`${projectId}:`) &&
      (key.endsWith(`:${normPath}`) || key.includes(`:${normPath}/`))
    ) {
      fileContentCache.delete(key);
    }
  }
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (
        k &&
        k.startsWith(`${CACHE_PREFIX}${projectId}:`) &&
        (k.endsWith(`:${normPath}`) || k.includes(`:${normPath}/`))
      ) {
        sessionStorage.removeItem(k);
      }
    }
  } catch (_) {}
}

export async function getFileContentApi(projectId, filePath, options = {}) {
  const { snapshotId, signal, forceFresh } =
    typeof options === "string" ? { snapshotId: options } : options || {};

  if (!forceFresh) {
    const cached = getFileContentFromCache(projectId, filePath, snapshotId);
    if (cached) {
      return { success: true, data: cached, fromCache: true };
    }
  }

  const res = await editorAwareFetch(
    `${BASE_URL}/projects/${projectId}/file-content?path=${encodeURIComponent(filePath)}${snapshotId ? `&snapshotId=${encodeURIComponent(snapshotId)}` : ""}`,
    {
      headers: getAuthHeaders(),
      signal,
    },
  );
  const data = await handleResponse(res);
  if (data?.data) {
    setFileContentToCache(projectId, filePath, data.data, snapshotId);
  }
  return data;
}

export async function updateFileContentApi(
  projectId,
  filePath,
  content,
  {
    snapshotId,
    expectedVersion,
    expectedWorkspaceRevision,
    requestId = crypto.randomUUID(),
  } = {},
) {
  const { saveActiveCollaborativeFile } =
    await import("../lib/editor/editorModelRegistry");
  const live = await saveActiveCollaborativeFile(
    projectId,
    snapshotId,
    filePath,
    content,
  );
  if (live) return live;
  const res = await editorAwareFetch(
    `${BASE_URL}/projects/${projectId}/file-content`,
    {
      method: "PUT",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        path: filePath,
        content,
        snapshotId,
        expectedVersion,
        expectedWorkspaceRevision,
        requestId,
      }),
    },
  );
  const data = await handleResponse(res);
  if (data?.data) {
    setFileContentToCache(projectId, filePath, data.data, snapshotId);
  } else {
    const existing =
      getFileContentFromCache(projectId, filePath, snapshotId) || {};
    setFileContentToCache(
      projectId,
      filePath,
      {
        ...existing,
        content,
        path: filePath,
        version: (existing.version || 0) + 1,
        snapshotId,
      },
      snapshotId,
    );
  }
  return data;
}

export async function createProjectFileApi(
  projectId,
  filePath,
  content = "",
  options = {},
) {
  const res = await editorAwareFetch(
    `${BASE_URL}/projects/${projectId}/files`,
    {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        path: filePath,
        content,
        ...options,
        requestId: options.requestId || crypto.randomUUID(),
      }),
    },
  );
  const data = await handleResponse(res);
  setFileContentToCache(
    projectId,
    filePath,
    {
      content,
      path: filePath,
      version: 0,
      snapshotId: options.snapshotId,
      workspaceRevision: options.expectedWorkspaceRevision || 0,
    },
    options.snapshotId,
  );
  return data;
}

export async function createProjectFolderApi(
  projectId,
  folderPath,
  options = {},
) {
  const res = await editorAwareFetch(
    `${BASE_URL}/projects/${projectId}/folders`,
    {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        path: folderPath,
        ...options,
        requestId: options.requestId || crypto.randomUUID(),
      }),
    },
  );
  return handleResponse(res);
}

export async function renameProjectEntryApi(
  projectId,
  filePath,
  newPath,
  options = {},
) {
  const res = await editorAwareFetch(
    `${BASE_URL}/projects/${projectId}/entries`,
    {
      method: "PATCH",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        path: filePath,
        newPath,
        ...options,
        requestId: options.requestId || crypto.randomUUID(),
      }),
    },
  );
  const data = await handleResponse(res);
  const oldCached = getFileContentFromCache(
    projectId,
    filePath,
    options.snapshotId,
  );
  invalidateFileContentCache(projectId, filePath);
  if (oldCached) {
    setFileContentToCache(
      projectId,
      newPath,
      { ...oldCached, path: newPath },
      options.snapshotId,
    );
  }
  return data;
}

export async function deleteProjectEntryApi(projectId, filePath, options = {}) {
  const queryParams = new URLSearchParams({ path: filePath });
  if (options.snapshotId) queryParams.set("snapshotId", options.snapshotId);
  if (options.expectedWorkspaceRevision !== undefined) {
    queryParams.set(
      "expectedWorkspaceRevision",
      String(options.expectedWorkspaceRevision),
    );
  }
  const res = await editorAwareFetch(
    `${BASE_URL}/projects/${projectId}/entries?${queryParams.toString()}`,
    {
      method: "DELETE",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        ...options,
        path: filePath,
        requestId: options.requestId || crypto.randomUUID(),
      }),
    },
  );
  const data = await handleResponse(res);
  invalidateFileContentCache(projectId, filePath);
  return data;
}

export async function getUserProfileApi() {
  const res = await editorAwareFetch(`${BASE_URL}/users/me`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function sendAiChatMessageApi(
  projectId,
  message,
  history,
  model,
  attachments = [],
  sessionId = null,
  context = {},
) {
  const res = await editorAwareFetch(`${BASE_URL}/projects/${projectId}/chat`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({
      message,
      model,
      attachments,
      sessionId,
      ...context,
    }),
  });
  return handleResponse(res);
}

export async function getChatSessionsApi(projectId) {
  const res = await editorAwareFetch(
    `${BASE_URL}/projects/${projectId}/chat/sessions`,
    {
      headers: getAuthHeaders(),
    },
  );
  return handleResponse(res);
}

export async function createChatSessionApi(projectId, title) {
  const res = await editorAwareFetch(
    `${BASE_URL}/projects/${projectId}/chat/sessions`,
    {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ title }),
    },
  );
  return handleResponse(res);
}

export async function getChatSessionMessagesApi(projectId, sessionId) {
  const res = await editorAwareFetch(
    `${BASE_URL}/projects/${projectId}/chat/sessions/${sessionId}`,
    {
      headers: getAuthHeaders(),
    },
  );
  return handleResponse(res);
}

export async function updateChatSessionApi(projectId, sessionId, title) {
  const res = await editorAwareFetch(
    `${BASE_URL}/projects/${projectId}/chat/sessions/${sessionId}`,
    {
      method: "PATCH",
      headers: getAuthHeaders(),
      body: JSON.stringify({ title }),
    },
  );
  return handleResponse(res);
}

export async function deleteChatSessionApi(projectId, sessionId) {
  const res = await editorAwareFetch(
    `${BASE_URL}/projects/${projectId}/chat/sessions/${sessionId}`,
    {
      method: "DELETE",
      headers: getAuthHeaders(),
    },
  );
  return handleResponse(res);
}

export async function getProjectCfgApi(projectId, snapshotId) {
  const query = snapshotId
    ? `?snapshotId=${encodeURIComponent(snapshotId)}`
    : "";
  const res = await fetch(`${BASE_URL}/projects/${projectId}/cfg${query}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function getProjectCcApi(projectId, snapshotId) {
  const query = snapshotId
    ? `?snapshotId=${encodeURIComponent(snapshotId)}`
    : "";
  const res = await fetch(`${BASE_URL}/projects/${projectId}/cc${query}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function buildCfgApi(projectId, snapshotId) {
  const body = snapshotId ? { snapshotId } : {};
  const res = await fetch(`${BASE_URL}/projects/${projectId}/cfg/build`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
  });
  return handleResponse(res);
}

export async function getAiSuggestionsApi(projectId) {
  const res = await editorAwareFetch(
    `${BASE_URL}/ai-suggestions?projectId=${projectId}`,
    {
      headers: getAuthHeaders(),
    },
  );
  return handleResponse(res);
}

export async function getProjectSnapshotsApi(projectId) {
  const res = await editorAwareFetch(
    `${BASE_URL}/projects/${projectId}/snapshots`,
    {
      headers: getAuthHeaders(),
    },
  );
  return handleResponse(res);
}

export async function getProjectStructureAnalysisApi(projectId, snapshotId) {
  const query = snapshotId
    ? `?snapshotId=${encodeURIComponent(snapshotId)}`
    : "";
  const res = await editorAwareFetch(
    `${BASE_URL}/projects/${projectId}/structure-analysis${query}`,
    {
      headers: getAuthHeaders(),
    },
  );
  return handleResponse(res);
}

export async function runAnalysisApi(projectId, { snapshotId, testType } = {}) {
  const res = await editorAwareFetch(
    `${BASE_URL}/projects/${projectId}/run-analysis`,
    {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ snapshotId, testType }),
    },
  );
  // Return job so client can poll
  const data = await handleResponse(res);
  return data && data.data && data.data.job ? data.data.job : data;
}

export async function runProjectStructureAnalysisApi(projectId, snapshotId) {
  const res = await editorAwareFetch(
    `${BASE_URL}/projects/${projectId}/structure-analysis`,
    {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(snapshotId ? { snapshotId } : {}),
    },
  );
  return handleResponse(res);
}

export async function generateSkeletonApi(
  projectId,
  snapshotId,
  mode = "SKELETON",
) {
  const res = await editorAwareFetch(
    `${BASE_URL}/projects/${projectId}/ai-tests`,
    {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ snapshotId, mode }),
    },
  );
  return handleResponse(res);
}

export function generateSystemTestApi(
  projectId,
  snapshotId,
  executionMode = "full",
) {
  return fetch(`${BASE_URL}/projects/${projectId}/ai-tests`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ snapshotId, mode: "PLAYWRIGHT_E2E", executionMode }),
  }).then(handleResponse);
}

export async function generateIntegrationTestApi(
  projectId,
  snapshotId,
  force = false,
  targetEndpoints = null,
) {
  const res = await editorAwareFetch(
    `${BASE_URL}/projects/${projectId}/ai/generate-integration-test`,
    {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        snapshotId,
        framework: "SUPERTEST",
        force,
        targetEndpoints,
      }),
    },
  );
  return handleResponse(res);
}

export async function getFrameworkRecommendationApi(projectId, snapshotId) {
  const query = snapshotId
    ? `?snapshotId=${encodeURIComponent(snapshotId)}`
    : "";
  const res = await editorAwareFetch(
    `${BASE_URL}/projects/${projectId}/test-framework-recommendation${query}`,
    {
      headers: getAuthHeaders(),
    },
  );
  return handleResponse(res);
}

export async function selectTestingFrameworkApi(
  projectId,
  snapshotId,
  framework,
) {
  const res = await editorAwareFetch(
    `${BASE_URL}/projects/${projectId}/test-framework-selection`,
    {
      method: "PUT",
      headers: getAuthHeaders(),
      body: JSON.stringify({ snapshotId, framework }),
    },
  );
  return handleResponse(res);
}

export async function createProjectSnapshotApi(projectId, { label, message }) {
  const res = await editorAwareFetch(
    `${BASE_URL}/projects/${projectId}/snapshots`,
    {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ label, message }),
    },
  );
  return handleResponse(res);
}

export async function activateProjectSnapshotApi(projectId, snapshotId) {
  const res = await fetch(
    `${BASE_URL}/projects/${projectId}/snapshots/${snapshotId}/activate`,
    {
      method: "POST",
      headers: getAuthHeaders(),
    },
  );
  return handleResponse(res);
}

export async function restoreProjectSnapshotApi(projectId, snapshotId) {
  const res = await editorAwareFetch(
    `${BASE_URL}/projects/${projectId}/snapshots/${snapshotId}/restore`,
    {
      method: "POST",
      headers: getAuthHeaders(),
    },
  );
  return handleResponse(res);
}

export async function getArchitectureAiSummaryApi(
  projectId,
  { snapshotId, filePath, force = false },
) {
  const res = await editorAwareFetch(
    `${BASE_URL}/projects/${projectId}/architecture/ai-summary`,
    {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ snapshotId, filePath, force }),
    },
  );
  return handleResponse(res);
}

export async function getProjectIntegrationDetection(projectId) {
  const res = await editorAwareFetch(
    `${BASE_URL}/projects/${projectId}/integration/frameworks`,
    {
      headers: getAuthHeaders(),
    },
  );
  return handleResponse(res);
}

export async function getProjectEventsApi(
  projectId,
  { after = 0, limit = 100 } = {},
) {
  const res = await fetch(
    `${BASE_URL}/projects/${projectId}/events?after=${after}&limit=${limit}`,
    {
      headers: getAuthHeaders(),
    },
  );
  return handleResponse(res);
}
