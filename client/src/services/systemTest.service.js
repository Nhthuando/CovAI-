import axios from "axios";

const API_BASE =
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE ||
  "http://localhost:5000/api";

function getAuthHeaders() {
  const user = localStorage.getItem("user");
  const userToken = user ? JSON.parse(user).token : null;
  const token = localStorage.getItem("token") || userToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const getSystemTestFrameworks = async (projectId, snapshotId = null) => {
  const params = new URLSearchParams();
  if (snapshotId) {
    params.append("snapshotId", snapshotId);
  }
  const queryString = params.toString() ? `?${params.toString()}` : "";
  const response = await axios.get(
    `${API_BASE}/projects/${projectId}/system-test/frameworks${queryString}`,
    { headers: getAuthHeaders() },
  );
  return response.data;
};

export const runPlaywrightTests = async (projectId, snapshotId) => {
  const response = await axios.post(
    `${API_BASE}/projects/${projectId}/run-playwright`,
    { snapshotId },
    { headers: getAuthHeaders() },
  );
  return response.data;
};

export const runCypressTests = async (projectId, snapshotId) => {
  const response = await axios.post(
    `${API_BASE}/projects/${projectId}/run-cypress`,
    { snapshotId },
    { headers: getAuthHeaders() },
  );
  return response.data;
};

export const runSystemTestAnalysis = async (
  projectId,
  snapshotId,
  runner = null,
) => {
  const response = await axios.post(
    `${API_BASE}/projects/${projectId}/system-test-analysis`,
    { snapshotId, runner },
    { headers: getAuthHeaders() },
  );
  return response.data;
};
