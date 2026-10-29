const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

function getAuthHeaders() {
  const user = localStorage.getItem("user");
  const userToken = user ? JSON.parse(user).token : null;
  const token = localStorage.getItem("token") || userToken;

  return {
    "Content-Type": "application/json",
    ...(token && {
      Authorization: `Bearer ${token}`,
    }),
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

/**
 * Version History & Provenance API Service
 * Handles historical pipeline version snapshots, chronological activity tracking,
 * and read-only artifact inspections.
 */

export async function getIntegrationVersionHistory(snapshotId, options = {}) {
  const cleanOptions = {};
  for (const [k, v] of Object.entries(options)) {
    if (v != null && v !== "") cleanOptions[k] = v;
  }
  const params = new URLSearchParams(cleanOptions);
  const queryString = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(
    `${BASE_URL}/coverage/${snapshotId}/integration/version-history${queryString}`,
    {
      headers: getAuthHeaders(),
    }
  );
  return handleResponse(res);
}

export async function compareIntegrationVersions(snapshotId, versionAId, versionBId, type = "ANALYZE") {
  const params = new URLSearchParams({ versionAId, versionBId, type });
  const res = await fetch(
    `${BASE_URL}/coverage/${snapshotId}/integration/version-compare?${params.toString()}`,
    {
      headers: getAuthHeaders(),
    }
  );
  return handleResponse(res);
}

export async function getHistoricalWorkspaceVersion(snapshotId, versionId, type = "ANALYZE") {
  const params = new URLSearchParams({ type });
  const res = await fetch(
    `${BASE_URL}/coverage/${snapshotId}/integration/version/${versionId}?${params.toString()}`,
    {
      headers: getAuthHeaders(),
    }
  );
  return handleResponse(res);
}

export async function getBeforeAfterComparison(projectId, options = {}) {
  const cleanOptions = {};
  for (const [k, v] of Object.entries(options)) {
    if (v != null && v !== "") cleanOptions[k] = v;
  }
  const params = new URLSearchParams(cleanOptions);
  const queryString = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(
    `${BASE_URL}/coverage/project/${projectId}/comparison${queryString}`,
    {
      headers: getAuthHeaders(),
    }
  );
  return handleResponse(res);
}

export async function getSourceFileDiff(projectId, options = {}) {
  const params = new URLSearchParams(options);
  const res = await fetch(
    `${BASE_URL}/coverage/project/${projectId}/comparison/source-file?${params.toString()}`,
    {
      headers: getAuthHeaders(),
    }
  );
  return handleResponse(res);
}
