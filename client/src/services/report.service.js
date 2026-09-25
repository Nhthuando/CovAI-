const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

function getAuthHeaders() {
  const token = localStorage.getItem("token") || (localStorage.getItem("user") ? JSON.parse(localStorage.getItem("user")).token : null);
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
      window.location.href = "/login";
    }
    throw new Error(data.message || `API Error: ${res.status}`);
  }
  return data;
}

export const fetchIntegrationReport = async (projectId) => {
  const res = await fetch(`${BASE_URL}/reports/project/${projectId}/integration`, {
    headers: getAuthHeaders(),
  });
  return handleResponse(res);
};
