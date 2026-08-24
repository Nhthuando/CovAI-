import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3000/api";

export const getSystemTestFrameworks = async (projectId, snapshotId = null) => {
  const params = new URLSearchParams();
  if (snapshotId) {
    params.append("snapshotId", snapshotId);
  }
  const response = await axios.get(
    `${API_BASE}/projects/${projectId}/system-test/frameworks?${params.toString()}`,
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
