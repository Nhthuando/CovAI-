const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

function getAuthHeaders() {
  const user = localStorage.getItem("user");
  const userToken = user ? JSON.parse(user).token : null;
  const token = localStorage.getItem("token") || userToken;
  return {
    "Content-Type": "application/json",
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
    throw new Error(data.message || "Failed API call");
  }
  return data;
}

/**
 * GET /api/job/:projectId/jobs
 * Returns { message, jobs }
 */
export async function getProjectJobsApi(projectId) {
  const res = await fetch(`${BASE_URL}/job/${projectId}/jobs`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}

/**
 * GET /api/job/user
 * Returns { message, jobs }
 */
export async function getUserJobsApi() {
  const res = await fetch(`${BASE_URL}/job/user`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}

/**
 * GET /api/job/:jobId
 * Returns { message, job }
 */
export async function getJobDetailApi(jobId) {
  const res = await fetch(`${BASE_URL}/job/${jobId}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
}
