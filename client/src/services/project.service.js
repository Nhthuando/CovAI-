const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

function getAuthHeaders() {
  const user = localStorage.getItem("user");
  const userToken = user ? JSON.parse(user).token : null;
  const token = localStorage.getItem("token") || userToken;
  return {
    "Content-Type": "application/json",
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
    throw new Error(data.message || "Failed API call");
  }
  return data;
}

export async function createProjectApi({ name, description, repoUrl }) {
  const res = await fetch(`${BASE_URL}/projects`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ name, description, repoUrl }),
  });
  return handleResponse(res);
}

export async function getProjectsApi() {
  const res = await fetch(`${BASE_URL}/projects`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function deleteProjectApi(projectId) {
  const res = await fetch(`${BASE_URL}/projects/${projectId}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function getProjectTreeApi(projectId) {
  const res = await fetch(`${BASE_URL}/projects/${projectId}/tree`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function uploadZipApi(projectId, file) {
  const userStr = localStorage.getItem("user");
  const userToken = userStr ? JSON.parse(userStr).token : null;
  const token = localStorage.getItem("token") || userToken;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("projectId", projectId);

  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}/projects/${projectId}/upload-zip`, {
    method: "POST",
    headers,
    body: formData,
  });
  return handleResponse(res);
}

export async function importGithubUrlApi(projectId, url) {
  const res = await fetch(`${BASE_URL}/github/projects/${projectId}/import-github-url`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ url }),
  });
  return handleResponse(res);
}

export async function importGithubRepoApi(projectId, owner, repo) {
  const res = await fetch(`${BASE_URL}/github/projects/${projectId}/import-github-repo`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ owner, repo }),
  });
  return handleResponse(res);
}

export async function getGithubRepositoriesApi() {
  const res = await fetch(`${BASE_URL}/auth/github/repositories`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function getFileContentApi(projectId, filePath) {
  const res = await fetch(
    `${BASE_URL}/projects/${projectId}/file-content?path=${encodeURIComponent(filePath)}`,
    {
      headers: getAuthHeaders(),
    }
  );
  return handleResponse(res);
}

export async function updateFileContentApi(projectId, filePath, content) {
  const res = await fetch(`${BASE_URL}/projects/${projectId}/file-content`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify({ path: filePath, content }),
  });
  return handleResponse(res);
}

export async function createProjectFileApi(projectId, filePath, content = "") {
  const res = await fetch(`${BASE_URL}/projects/${projectId}/files`, {
    method: "POST", headers: getAuthHeaders(), body: JSON.stringify({ path: filePath, content }),
  });
  return handleResponse(res);
}

export async function createProjectFolderApi(projectId, folderPath) {
  const res = await fetch(`${BASE_URL}/projects/${projectId}/folders`, {
    method: "POST", headers: getAuthHeaders(), body: JSON.stringify({ path: folderPath }),
  });
  return handleResponse(res);
}

export async function renameProjectEntryApi(projectId, filePath, newPath) {
  const res = await fetch(`${BASE_URL}/projects/${projectId}/entries`, {
    method: "PATCH", headers: getAuthHeaders(), body: JSON.stringify({ path: filePath, newPath }),
  });
  return handleResponse(res);
}

export async function deleteProjectEntryApi(projectId, filePath) {
  const res = await fetch(`${BASE_URL}/projects/${projectId}/entries?path=${encodeURIComponent(filePath)}`, {
    method: "DELETE", headers: getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function getUserProfileApi() {
  const res = await fetch(`${BASE_URL}/users/me`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function sendAiChatMessageApi(projectId, message, history) {
  const res = await fetch(`${BASE_URL}/projects/${projectId}/chat`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ message, history }),
  });
  return handleResponse(res);
}

export async function getProjectCfgApi(projectId, snapshotId) {
  const res = await fetch(`${BASE_URL}/projects/${projectId}/cfg?snapshotId=${snapshotId}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function getProjectCcApi(projectId, snapshotId) {
  const res = await fetch(`${BASE_URL}/projects/${projectId}/cc?snapshotId=${snapshotId}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function buildCfgApi(projectId, snapshotId) {
  const res = await fetch(`${BASE_URL}/projects/${projectId}/cfg/build`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ snapshotId }),
  });
  return handleResponse(res);
}

export async function getAiSuggestionsApi(projectId) {
  const res = await fetch(`${BASE_URL}/ai-suggestions?projectId=${projectId}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function runAnalysisApi(projectId, options = {}) {
  const res = await fetch(`${BASE_URL}/projects/${projectId}/run-analysis`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(options),
  });
  return handleResponse(res);
}

export async function generateSkeletonApi(projectId, snapshotId) {
  const res = await fetch(`${BASE_URL}/projects/${projectId}/ai-tests`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ snapshotId }),
  });
  return handleResponse(res);
}

export async function generateFullTestsApi(projectId, snapshotId) {
  const res = await fetch(`${BASE_URL}/projects/${projectId}/ai/generate-full-test`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ snapshotId }),
  });
  return handleResponse(res);
}
