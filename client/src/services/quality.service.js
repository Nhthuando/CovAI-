const BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:3000/api";

function getAuthHeaders() {
  const token = localStorage.getItem("token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function handleResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }
    throw new Error(data.message || "API call failed");
  }
  return data;
}

/**
 * POST /api/projects/:id/quality-analysis
 */
export async function startQualityAnalysisApi(projectId, snapshotId) {
  const res = await fetch(`${BASE_URL}/projects/${projectId}/quality-analysis`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(snapshotId ? { snapshotId } : {}),
  });
  return handleResponse(res);
}

/**
 * GET /api/projects/:id/quality-report
 */
export async function getQualityReportApi(projectId) {
  const res = await fetch(`${BASE_URL}/projects/${projectId}/quality-report`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}
