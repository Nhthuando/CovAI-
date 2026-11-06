const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

function getAuthToken() {
  let token = localStorage.getItem("token");
  if (!token) {
    try {
      token = JSON.parse(localStorage.getItem("user") || "null")?.token;
    } catch {
      // ignore
    }
  }
  return token || "";
}

export async function getAiQuotasApi() {
  const token = getAuthToken();
  const res = await fetch(`${BASE_URL}/settings/ai-quotas`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.message || "Failed to fetch AI quota settings.");
  }

  const json = await res.json();
  return json.data;
}

export async function resetAiQuotasApi(channelId = null) {
  const token = getAuthToken();
  const res = await fetch(`${BASE_URL}/settings/ai-quotas/reset`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channelId }),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.message || "Failed to reset AI quota counters.");
  }

  const json = await res.json();
  return json.data;
}

export async function updateAiQuotaLimitApi(channelId, quotaLimit) {
  const token = getAuthToken();
  const res = await fetch(`${BASE_URL}/settings/ai-quotas/limit`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channelId, quotaLimit }),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.message || "Failed to update quota limit.");
  }

  const json = await res.json();
  return json.data;
}
