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
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function handleResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      await handleUnauthorizedResponse();
    }
    throw new Error(data.message || "API call failed");
  }
  return data;
}

/**
 * POST /api/projects/:id/quality-analysis
 */
export async function startQualityAnalysisApi(projectId, snapshotId) {
  const res = await authAwareFetch(
    fetch,
    `${BASE_URL}/projects/${projectId}/quality-analysis`,
    {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(snapshotId ? { snapshotId } : {}),
    },
  );
  return handleResponse(res);
}

/**
 * GET /api/projects/:id/quality-report
 */
export async function getQualityReportApi(projectId) {
  const res = await authAwareFetch(
    fetch,
    `${BASE_URL}/projects/${projectId}/quality-report`,
    {
      headers: getAuthHeaders(),
    },
  );
  return handleResponse(res);
}
