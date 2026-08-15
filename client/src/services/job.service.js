const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

function clearAuthState() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  localStorage.removeItem("userName");
  localStorage.removeItem("userEmail");
}

function getAuthHeaders() {
  try {
    const user = localStorage.getItem("user");
    const userToken = user ? JSON.parse(user).token : null;
    const token = localStorage.getItem("token") || userToken;

    if (!token) {
      clearAuthState();
      return { "Content-Type": "application/json" };
    }

    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  } catch {
    clearAuthState();
    return { "Content-Type": "application/json" };
  }
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

/**
 * GET /api/job/:projectId/jobs
 * Returns { message, jobs }
 */
export async function getProjectJobsApi(projectId) {
  try {
    const res = await fetch(`${BASE_URL}/job/${projectId}/jobs`, {
      headers: getAuthHeaders(),
    });
    return handleResponse(res);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("Không thể kết nối tới backend. Server có thể đang restart hoặc offline.");
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
    const res = await fetch(`${BASE_URL}/job/user`, {
      headers: getAuthHeaders(),
    });
    return handleResponse(res);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("Không thể kết nối tới backend. Server có thể đang restart hoặc offline.");
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
    const res = await fetch(`${BASE_URL}/job/${jobId}`, {
      headers: getAuthHeaders(),
    });
    return handleResponse(res);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("Không thể kết nối tới backend. Server có thể đang restart hoặc offline.");
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
