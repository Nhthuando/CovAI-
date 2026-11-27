import { editorAwareFetch } from './editorAwareRequest';
import { getAIModelHeaders } from './aiModel.service.js';
import {
  API_BASE,
  getAccessToken,
  handleUnauthorizedResponse,
} from "../lib/authSession.js";
import {
  buildClientExportFilename,
  parseContentDispositionFilename,
} from "./portfolioDashboard/portfolioExport.utils.js";

const BASE_URL = API_BASE;

function getAuthHeaders() {
  const token = getAccessToken();
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
      await handleUnauthorizedResponse();
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
 * Export canonical Portfolio report as PDF, CSV, or JSON binary Blob.
 */
export async function exportPortfolioReportApi({
  format = "pdf",
  scope = "active_kpi",
  projectIds = undefined,
  sections = undefined,
  filterSummary = undefined,
} = {}) {
  const payload = { format, scope };
  if (Array.isArray(projectIds)) {
    payload.projectIds = projectIds;
  }
  if (sections && typeof sections === "object") {
    payload.sections = sections;
  }
  if (typeof filterSummary === "string" && filterSummary.trim()) {
    payload.filterSummary = filterSummary.trim();
  }

  const res = await editorAwareFetch(`${BASE_URL}/portfolio/export`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    if (res.status === 401) {
      await handleUnauthorizedResponse();
    }
    const errData = await res.json().catch(() => ({}));
    const err = new Error(errData.message || `Export failed (HTTP ${res.status})`);
    err.status = res.status;
    err.code = errData.code;
    err.details = errData.details;
    throw err;
  }

  const blob = await res.blob();
  const fallback = buildClientExportFilename({ scope, format });
  const filename = parseContentDispositionFilename(
    res.headers.get("content-disposition"),
    fallback,
  );

  return {
    blob,
    filename,
    contentType: res.headers.get("content-type") || "",
  };
}

/**
 * Trigger browser download for an exported Portfolio report Blob.
 */
export function triggerPortfolioFileDownload(blob, filename) {
  if (!blob || typeof window === "undefined") return;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename || "covai-portfolio-report.pdf";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 1000);
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
