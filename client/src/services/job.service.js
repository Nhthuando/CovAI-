/* eslint-disable no-useless-assignment */
const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

function clearAuthState() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  localStorage.removeItem("userName");
  localStorage.removeItem("userEmail");
}

/**
 * ASYNC: Retry for token a few times to avoid race condition after login (REMOVE AFTER FIX VALIDATED)
 */
async function getAuthHeaders() {
  let tries = 0;
  let token = null;
  let userToken;
  while (tries < 20) {
    // wait up to 2s total
    const user = localStorage.getItem("user");
    userToken = user ? JSON.parse(user).token : null;
    token = localStorage.getItem("token") || userToken;
    if (token) break;
    await new Promise((res) => setTimeout(res, 100));
    tries++;
  }
  if (!token) {
    clearAuthState();
    return { "Content-Type": "application/json" };
  }
  return {
    "Content-Type": "application/json",
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
      clearAuthState();
      window.location.href = "/login";
    }
    throw new Error(data.message || `Request failed with status ${res.status}`);
  }

  return data;
}

async function fetchWithRetry(url, options = {}, retries = 1, delayMs = 400) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, options);
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
    return await fetchWithRetry(`${BASE_URL}/job/${projectId}/jobs`, { headers });
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
export async function getJobDetailApi(jobId) {
  try {
    const headers = await getAuthHeaders();
    return await fetchWithRetry(`${BASE_URL}/job/${jobId}`, { headers });
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
    const res = await fetch(`${BASE_URL}/job/${jobId}/cancel`, {
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
