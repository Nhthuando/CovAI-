import { editorAwareFetch } from './editorAwareRequest';
import { getAIModelHeaders } from './aiModel.service.js';

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
    err.details = data.details;
    throw err;
  }
  return data?.data !== undefined ? data.data : data;
}

/**
 * Fetch full live portfolio overview
 */
export async function getPortfolioOverviewApi(params = {}) {
  const query = new URLSearchParams();
  if (params.refresh) query.set('refresh', 'true');
  const qs = query.toString() ? `?${query.toString()}` : '';
  const res = await editorAwareFetch(`${BASE_URL}/portfolio/overview${qs}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}

/**
 * Trigger batch test suites execution across projects
 */
export async function batchRunSuitesApi({ projectIds, pillars } = {}) {
  const res = await editorAwareFetch(`${BASE_URL}/portfolio/batch-run`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ projectIds, pillars }),
  });
  return handleResponse(res);
}

/**
 * Compare 2-3 projects with 5-axis radar & ROI data
 */
export async function compareProjectsApi(projectIds = []) {
  const ids = Array.isArray(projectIds) ? projectIds.join(',') : projectIds;
  const res = await editorAwareFetch(`${BASE_URL}/portfolio/compare?projectIds=${encodeURIComponent(ids)}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}

/**
 * Export portfolio report as JSON or CSV
 */
export async function exportPortfolioReportApi({ format = 'json', scope = 'active' } = {}) {
  const res = await editorAwareFetch(`${BASE_URL}/portfolio/export`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ format, scope }),
  });
  if (format === 'csv') {
    const blob = await res.blob();
    return blob;
  }
  return handleResponse(res);
}

/**
 * Update project lifecycle status and/or pinned state
 */
export async function updateProjectLifecycleStatusApi(projectId, { lifecycleStatus, isPinned } = {}) {
  const body = {};
  if (lifecycleStatus !== undefined) body.lifecycleStatus = lifecycleStatus;
  if (isPinned !== undefined) body.isPinned = isPinned;

  const res = await editorAwareFetch(`${BASE_URL}/projects/${projectId}/status`, {
    method: "PATCH",
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
  });
  return handleResponse(res);
}
