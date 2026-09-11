import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

export const getSystemTestFrameworks = async (projectId, snapshotId = null) => {
  const params = new URLSearchParams();
  if (snapshotId) {
    params.append("snapshotId", snapshotId);
  }
  const user = localStorage.getItem("user");
  const userToken = user ? JSON.parse(user).token : null;
  const token = localStorage.getItem("token") || userToken;
  if (!token) throw new Error("No access token found for API call.");
  const response = await axios.get(
    `${API_BASE}/projects/${projectId}/system-test/frameworks?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  );
  return response.data;
};

export const runPlaywrightTests = async (projectId, snapshotId) => {
  const response = await axios.post(
    `${API_BASE}/projects/${projectId}/run-playwright`,
    { snapshotId },
  );
  return response.data;
};

export const runCypressTests = async (projectId, snapshotId) => {
  const response = await axios.post(
    `${API_BASE}/projects/${projectId}/run-cypress`,
    { snapshotId },
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
  );
  return response.data;
};
