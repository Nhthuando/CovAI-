import { queryClient } from "../lib/queryClient";
import { rememberAuthReturn } from "../lib/authReturn";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

export async function collaborationRequest(path, { body, headers, ...options } = {}) {
  const token = localStorage.getItem("token");
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const result = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      rememberAuthReturn(window.location.pathname);
      queryClient.cancelQueries(); queryClient.clear();
      for (const key of ["token", "user", "userName", "userEmail"]) localStorage.removeItem(key);
      window.location.assign("/login");
    }
    const error = new Error(result.message || "Unable to complete this action. Please retry.");
    Object.assign(error, { status: response.status, code: result.code, details: result.details });
    throw error;
  }
  return result.data ?? result;
}

export const projectPath = projectId => `/projects/${encodeURIComponent(projectId)}`;
