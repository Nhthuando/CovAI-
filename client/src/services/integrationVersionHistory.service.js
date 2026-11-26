import { API_BASE, authAwareFetch, getAccessToken, handleUnauthorizedResponse } from "../lib/authSession.js";
const BASE_URL = API_BASE;

function getAuthHeaders() {
  const token = getAccessToken();

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
      await handleUnauthorizedResponse();
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
  const res = await authAwareFetch(
    fetch,
    `${BASE_URL}/coverage/${snapshotId}/integration/version-history${queryString}`,
    {
      headers: getAuthHeaders(),
    }
  );
  return handleResponse(res);
}

export async function compareIntegrationVersions(snapshotId, versionAId, versionBId, type = "ANALYZE") {
  const params = new URLSearchParams({ versionAId, versionBId, type });
  const res = await authAwareFetch(
    fetch,
    `${BASE_URL}/coverage/${snapshotId}/integration/version-compare?${params.toString()}`,
    {
      headers: getAuthHeaders(),
    }
  );
  return handleResponse(res);
}

export async function getHistoricalWorkspaceVersion(snapshotId, versionId, type = "ANALYZE") {
  const params = new URLSearchParams({ type });
  const res = await authAwareFetch(
    fetch,
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
  const res = await authAwareFetch(
    fetch,
    `${BASE_URL}/coverage/project/${projectId}/comparison${queryString}`,
    {
      headers: getAuthHeaders(),
    }
  );
  return handleResponse(res);
}

export async function getSourceFileDiff(projectId, options = {}) {
  const params = new URLSearchParams(options);
  const res = await authAwareFetch(
    fetch,
    `${BASE_URL}/coverage/project/${projectId}/comparison/source-file?${params.toString()}`,
    {
      headers: getAuthHeaders(),
    }
  );
  return handleResponse(res);
}
