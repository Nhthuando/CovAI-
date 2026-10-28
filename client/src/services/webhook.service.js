import api from "./api.js";

/**
 * Enable webhook for a project
 */
export const enableWebhookApi = async (projectId, branch = "main") => {
  const response = await api.post("/webhook/enable", {
    projectId,
    branch,
  });
  return response.data;
};

/**
 * Disable webhook for a project
 */
export const disableWebhookApi = async (projectId) => {
  const response = await api.post("/webhook/disable", {
    projectId,
  });
  return response.data;
};

/**
 * Get webhook configuration for a project
 */
export const getWebhookConfigApi = async (projectId) => {
  const response = await api.get(`/webhook/config/${projectId}`);
  return response.data;
};

/**
 * Update webhook branch
 */
export const updateWebhookBranchApi = async (projectId, branch) => {
  const response = await api.post("/webhook/update-branch", {
    projectId,
    branch,
  });
  return response.data;
};
