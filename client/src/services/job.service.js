import { getAIModelHeaders } from "./aiModel.service.js";
import {
  API_BASE,
  authAwareFetch,
  getAccessToken,
  handleUnauthorizedResponse,
} from "../lib/authSession.js";
/* eslint-disable no-useless-assignment */
const BASE_URL = API_BASE;

async function getAuthHeaders() {
  let tries = 0;
  let token = null;
  while (tries < 20) {
    token = getAccessToken();
    if (token) break;
    await new Promise((res) => setTimeout(res, 100));
    tries++;
  }
  if (!token) {
    return { "Content-Type": "application/json", ...getAIModelHeaders() };
  }
  return {
    "Content-Type": "application/json",
    ...getAIModelHeaders(),
    Authorization: `Bearer ${token}`,
  };
}

async function handleResponse(res) {
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    if (res.status === 401) {
      await handleUnauthorizedResponse();
    }
    const error = new Error(
      data.message || `Request failed with status ${res.status}`,
    );
    Object.assign(error, {
      status: res.status,
      code: data.code,
      details: data.details,
    });
    throw error;
  }

  return data;
}

async function fetchWithRetry(url, options = {}, retries = 1, delayMs = 400) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await authAwareFetch(fetch, url, options);
      if (res.status >= 500 && i < retries) {
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      return await handleResponse(res);
    } catch (err) {
      if (i < retries) {
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
}

/**
 * GET /api/job/:projectId/jobs
 * Returns { message, jobs }
 */
export async function getProjectJobsApi(projectId) {
  try {
    const headers = await getAuthHeaders();
    return await fetchWithRetry(`${BASE_URL}/job/${projectId}/jobs`, {
      headers,
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        "Unable to connect to backend server. The server may be restarting or offline.",
      );
    }
    throw error;
  }
}

/**
 * GET /api/job/user
 * Returns { message, jobs }
 */
export async function getUserJobsApi() {
  try {
    const headers = await getAuthHeaders();
    return await fetchWithRetry(`${BASE_URL}/job/user`, { headers });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        "Unable to connect to backend server. The server may be restarting or offline.",
      );
    }
    throw error;
  }
}

/**
 * GET /api/job/:jobId
 * Returns { message, job }
 */
export async function getJobDetailApi(jobId, options = {}) {
  try {
    const headers = await getAuthHeaders();
    const params = new URLSearchParams();
    if (options?.summary) params.set("summary", "1");
    if (options?.includeLogs) params.set("includeLogs", "1");
    const qs = params.toString();
    const url = qs
      ? `${BASE_URL}/job/${jobId}?${qs}`
      : `${BASE_URL}/job/${jobId}`;
    return await fetchWithRetry(url, { headers });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        "Unable to connect to backend. Server may be restarting or offline.",
      );
    }
    throw error;
  }
}

/**
 * POST /api/job/:jobId/cancel
 * Cancels or stops a running/queued job
 */
export async function cancelJobApi(jobId) {
  try {
    const res = await authAwareFetch(fetch, `${BASE_URL}/job/${jobId}/cancel`, {
      method: "POST",
      headers: await getAuthHeaders(),
    });
    return handleResponse(res);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        "Unable to connect to backend server. The server may be restarting or offline.",
      );
    }
    throw error;
  }
}

/**
 * GET /api/performance/snapshot/:snapshotId
 * Returns { metric, slowFunctions }
 */
// export async function getPerformanceSnapshotApi(snapshotId) {
//   const res = await fetch(`${BASE_URL.replace('/api', '')}/api/performance/snapshot/${snapshotId}`, {
//     headers: getAuthHeaders(),
//   });
//   return handleResponse(res);
// }
