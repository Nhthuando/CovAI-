import { rememberAuthReturn } from "../lib/authReturn";
import {
  API_BASE,
  authAwareFetch,
  getAccessToken,
} from "../lib/authSession.js";

const BASE_URL = API_BASE;

export async function collaborationRequest(
  path,
  { body, headers, ...options } = {},
) {
  const token = getAccessToken();
  const response = await authAwareFetch(fetch, `${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const result =
    response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      rememberAuthReturn(window.location.pathname);
    }
    const error = new Error(
      result.message || "Unable to complete this action. Please retry.",
    );
    Object.assign(error, {
      status: response.status,
      code: result.code,
      details: result.details,
    });
    throw error;
  }
  return result.data ?? result;
}

export const projectPath = (projectId) =>
  `/projects/${encodeURIComponent(projectId)}`;
