import { authAwareFetch, getAccessToken, handleUnauthorizedResponse } from "../lib/authSession.js";
const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

function getAuthHeaders() {
  const token = getAccessToken();
  return {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
  };
}

async function handleResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      await handleUnauthorizedResponse();
    }
    throw new Error(data.message || `API Error: ${res.status}`);
  }
  return data;
}

export const fetchIntegrationReport = async (projectId) => {
  const res = await authAwareFetch(fetch, `${BASE_URL}/reports/project/${projectId}/integration?t=${Date.now()}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
};

export const fetchIntegrationGuidance = async (projectId) => {
  const res = await authAwareFetch(fetch, `${BASE_URL}/reports/project/${projectId}/integration/guidance?t=${Date.now()}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
};

export async function downloadIntegrationReportApi(projectId, { snapshotId = null, format = "pdf", signal } = {}) {
  const query = new URLSearchParams({ format });
  if (snapshotId) query.set("snapshotId", snapshotId);

  const token = getAccessToken();

  const response = await authAwareFetch(
    fetch,
    `${BASE_URL}/reports/project/${encodeURIComponent(projectId)}/integration/export?${query}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal,
    },
  );

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      await handleUnauthorizedResponse();
    }
    throw new Error(data.message || `Could not export ${format.toUpperCase()} report.`);
  }

  const blob = await response.blob();
  if (signal?.aborted) throw new DOMException("Download cancelled", "AbortError");

  const disposition = response.headers.get("Content-Disposition") || "";
  const candidate = disposition.match(/filename="([^"]+)"/)?.[1];
  const filename =
    candidate && /^[a-zA-Z0-9_.-]+$/.test(candidate)
      ? candidate
      : `integration-report-${projectId || "project"}.${format}`;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  return filename;
}
