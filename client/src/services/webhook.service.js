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

/**
 * Enable webhook for a project
 */
export const enableWebhookApi = async (projectId, branch = "main") => {
  const response = await axios.post(
    `${API_BASE}/webhook/enable`,
    { projectId, branch },
    { headers: getAuthHeaders() },
  );
  return response.data;
};

/**
 * Disable webhook for a project
 */
export const disableWebhookApi = async (projectId) => {
  const response = await axios.post(
    `${API_BASE}/webhook/disable`,
    { projectId },
    { headers: getAuthHeaders() },
  );
  return response.data;
};

/**
 * Get webhook configuration for a project
 */
export const getWebhookConfigApi = async (projectId) => {
  const response = await axios.get(
    `${API_BASE}/webhook/config/${projectId}`,
    { headers: getAuthHeaders() },
  );
  return response.data;
};

/**
 * Update webhook branch
 */
export const updateWebhookBranchApi = async (projectId, branch) => {
  const response = await axios.post(
    `${API_BASE}/webhook/update-branch`,
    { projectId, branch },
    { headers: getAuthHeaders() },
  );
  return response.data;
};
