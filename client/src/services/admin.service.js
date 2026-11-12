/**
 * Admin Service — API Client for CovAI Admin Console
 */

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

async function adminRequest(endpoint, options = {}, isRetry = false) {
  const token = localStorage.getItem("token");
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const url = `${BASE_URL}/admin${endpoint}`;
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
      credentials: "include",
    });
  } catch (netErr) {
    console.error(`[adminRequest Network Error on ${url}]:`, netErr);
    throw netErr;
  }

  // Handle Token Expiration (401) with auto-refresh
  if (response.status === 401 && !isRetry) {
    try {
      const storedRefreshToken = localStorage.getItem("refreshToken");
      const refreshResponse = await fetch(`${BASE_URL}/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ refreshToken: storedRefreshToken }),
      });
      if (refreshResponse.ok) {
        const { accessToken, refreshToken: newRefresh } = await refreshResponse.json();
        if (accessToken) {
          localStorage.setItem("token", accessToken);
          if (newRefresh) localStorage.setItem("refreshToken", newRefresh);
          window.dispatchEvent(new Event("covai:auth-change"));
          return adminRequest(endpoint, options, true);
        }
      }
    } catch (refreshErr) {
      console.warn("[adminRequest] Token refresh failed:", refreshErr);
    }
  }

  // Handle CSV or binary streams
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/csv")) {
    return await response.text();
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message =
      body?.message ||
      body?.error ||
      `Admin API request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.data = body;
    throw error;
  }

  return body;
}

export const adminService = {
  // Schema Introspection
  async getSchema() {
    const res = await adminRequest("/schema");
    return res?.data || res;
  },

  async getTableCounts() {
    const res = await adminRequest("/schema/counts");
    return res?.data || res;
  },

  async getModelSchema(model) {
    const res = await adminRequest(`/schema/${encodeURIComponent(model)}`);
    return res?.data || res;
  },

  // Dynamic Data Management (67 Tables)
  async listRecords(model, params = {}) {
    const query = new URLSearchParams();
    if (params.page) query.set("page", params.page);
    if (params.limit) query.set("limit", params.limit);
    if (params.sortBy) query.set("sortBy", params.sortBy);
    if (params.sortDir) {
      query.set("sortDir", params.sortDir);
      query.set("sortOrder", params.sortDir);
    }
    if (params.q) query.set("q", params.q);
    if (params.includeRelations !== undefined) query.set("includeRelations", String(params.includeRelations));
    if (params.filters) query.set("filters", JSON.stringify(params.filters));

    const qs = query.toString();
    const res = await adminRequest(`/data/${encodeURIComponent(model)}${qs ? `?${qs}` : ""}`);
    return {
      ...res,
      records: res?.data || res?.records || [],
      meta: res?.meta || { page: 1, limit: 25, total: 0, totalPages: 1 },
    };
  },

  async getRecord(model, id) {
    const res = await adminRequest(`/data/${encodeURIComponent(model)}/${encodeURIComponent(id)}`);
    return res?.data || res;
  },

  async createRecord(model, data) {
    const res = await adminRequest(`/data/${encodeURIComponent(model)}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    return res?.data || res;
  },

  async updateRecord(model, id, data) {
    const res = await adminRequest(`/data/${encodeURIComponent(model)}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    return res?.data || res;
  },

  async deleteRecord(model, id) {
    return adminRequest(`/data/${encodeURIComponent(model)}/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  async batchDelete(model, ids) {
    return adminRequest(`/data/${encodeURIComponent(model)}/batch-delete`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    });
  },

  async batchUpdate(model, ids, data) {
    return adminRequest(`/data/${encodeURIComponent(model)}/batch-update`, {
      method: "POST",
      body: JSON.stringify({ ids, data }),
    });
  },

  async exportCsv(model, params = {}) {
    const query = new URLSearchParams({ format: "csv" });
    if (params.q) query.set("q", params.q);
    if (params.filters) query.set("filters", JSON.stringify(params.filters));
    return adminRequest(`/data/${encodeURIComponent(model)}/export?${query.toString()}`);
  },

  // User Governance
  async listUsers(params = {}) {
    const query = new URLSearchParams();
    if (params.page) query.set("page", params.page);
    if (params.limit) query.set("limit", params.limit);
    if (params.q) query.set("q", params.q);
    if (params.role) query.set("role", params.role);
    if (params.suspended !== undefined) query.set("suspended", params.suspended);

    const qs = query.toString();
    const res = await adminRequest(`/users${qs ? `?${qs}` : ""}`);
    const usersList = Array.isArray(res?.data) ? res.data : (res?.data?.users || res?.users || []);
    return {
      ...res,
      users: usersList,
      aggregates: res?.aggregates || res?.data?.aggregates || {},
      meta: res?.meta || res?.data?.meta || { page: 1, limit: 25, total: usersList.length },
    };
  },

  async updateUserRole(id, systemRole) {
    return adminRequest(`/users/${encodeURIComponent(id)}/role`, {
      method: "PATCH",
      body: JSON.stringify({ systemRole }),
    });
  },

  async updateUserStatus(id, isSuspended, reason = "") {
    return adminRequest(`/users/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ isSuspended, reason }),
    });
  },

  async resetUserQuota(id, options = {}) {
    return adminRequest(`/users/${encodeURIComponent(id)}/reset-quota`, {
      method: "POST",
      body: JSON.stringify(options),
    });
  },

  // AI & LLM Observability
  async getAiOverview() {
    const res = await adminRequest("/ai/usage-overview");
    return res?.data || res;
  },

  async getAiQuotas(params = {}) {
    const query = new URLSearchParams();
    if (params.page) query.set("page", params.page);
    if (params.limit) query.set("limit", params.limit);
    const qs = query.toString();
    const res = await adminRequest(`/ai/quotas${qs ? `?${qs}` : ""}`);
    return {
      ...res,
      quotas: res?.data?.quotas || res?.data || res?.quotas || [],
      meta: res?.data?.meta || res?.meta || { page: 1, limit: 25, total: 0 },
    };
  },

  async getAiCacheStats() {
    const res = await adminRequest("/ai/cache-stats");
    return res?.data || res;
  },

  // BullMQ Queues
  async getQueuesStatus() {
    const res = await adminRequest("/queues/status");
    return res?.data || res;
  },

  async retryAllFailedJobs(queueName) {
    return adminRequest(`/queues/${encodeURIComponent(queueName)}/retry-all-failed`, {
      method: "POST",
    });
  },

  async purgeQueue(queueName, type = "failed", grace = 0) {
    return adminRequest(`/queues/${encodeURIComponent(queueName)}/purge`, {
      method: "POST",
      body: JSON.stringify({ type, grace }),
    });
  },

  async pauseQueue(queueName) {
    return adminRequest(`/queues/${encodeURIComponent(queueName)}/pause`, {
      method: "POST",
    });
  },

  async resumeQueue(queueName) {
    return adminRequest(`/queues/${encodeURIComponent(queueName)}/resume`, {
      method: "POST",
    });
  },

  // System Health
  async getHealthOverview() {
    const res = await adminRequest("/health/overview");
    return res?.data || res;
  },

  async cleanupTempWorkspace(maxAgeHours = 2) {
    return adminRequest("/health/cleanup-temp", {
      method: "POST",
      body: JSON.stringify({ maxAgeHours }),
    });
  },

  // Audit Logs
  async listAuditLogs(params = {}) {
    const query = new URLSearchParams();
    if (params.page) query.set("page", params.page);
    if (params.limit) query.set("limit", params.limit);
    if (params.actorId) query.set("actorId", params.actorId);
    if (params.targetModel) query.set("targetModel", params.targetModel);
    if (params.action) query.set("action", params.action);
    const qs = query.toString();
    const res = await adminRequest(`/audit-logs${qs ? `?${qs}` : ""}`);
    const logsList = Array.isArray(res?.data) ? res.data : (res?.data?.logs || res?.logs || []);
    return {
      ...res,
      logs: logsList,
      meta: res?.meta || res?.data?.meta || { page: 1, limit: 25, total: logsList.length },
    };
  },
};
