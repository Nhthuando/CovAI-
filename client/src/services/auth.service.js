import axios from "axios";
import {
  getAccessToken,
  isAuthEndpoint,
  installAxiosAuthRefresh,
  redirectToLogin,
  refreshAccessTokenWithStatus,
} from "../lib/authSession.js";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

async function fetchWithAuth(input, init = {}) {
  const token = getAccessToken();
  const headers = {
    ...init.headers,
    Authorization: token ? `Bearer ${token}` : "",
  };

  // credentials: the API sets the HttpOnly refresh-token cookie on login, register
  // and GitHub sign-in; a cross-origin fetch only stores it with "include".
  let response = await fetch(input, { ...init, headers, credentials: "include" });

  if (response.status === 401 && !init._retry && !isAuthEndpoint(input)) {
    const { token: accessToken, invalidSession } =
      await refreshAccessTokenWithStatus();
    if (accessToken) {
      response = await fetch(input, {
        ...init,
        headers: { ...headers, Authorization: `Bearer ${accessToken}` },
        credentials: "include",
        _retry: true,
      });
    } else if (invalidSession) {
      redirectToLogin();
    }
  }

  return response;
}

export function parseAuthErrorResponse(res, data, fallbackMessage) {
  if (data?.error && typeof data.error === "object") {
    const fieldErrors = {};
    for (const [key, msgs] of Object.entries(data.error)) {
      fieldErrors[key] = Array.isArray(msgs) ? msgs[0] : msgs;
    }
    return {
      type: "field",
      status: res?.status || 400,
      code: data?.code || "VALIDATION_ERROR",
      errors: fieldErrors,
    };
  }

  const retryHeader = res?.headers?.get?.("Retry-After");
  const parsedRetryHeader = retryHeader ? Number(retryHeader) : NaN;
  const retryAfterSeconds =
    typeof data?.retryAfterSeconds === "number"
      ? data.retryAfterSeconds
      : Number.isFinite(parsedRetryHeader) && parsedRetryHeader > 0
        ? parsedRetryHeader
        : null;

  return {
    type: "message",
    status: res?.status || 500,
    code: data?.code || null,
    message: data?.message || fallbackMessage,
    lockedUntil: data?.lockedUntil || null,
    retryAfterSeconds,
  };
}

const httpClient = axios.create({ baseURL: BASE_URL });
installAxiosAuthRefresh(httpClient);

export async function registerApi({ name, email, password }) {
  const res = await fetchWithAuth(`${BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw parseAuthErrorResponse(res, data, "Registration failed!");
  }
  return data;
}

export async function loginApi({ email, password }) {
  const res = await fetchWithAuth(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw parseAuthErrorResponse(res, data, "Login failed!");
  }
  return data;
}

/**
 * Fetch server-generated GitHub OAuth authorize URL (sets HttpOnly CSRF state cookie).
 * @param {"login"|"connect"} mode
 */
export async function fetchGithubAuthorizeUrlApi(mode = "login") {
  const safeMode = mode === "connect" ? "connect" : "login";
  const res = await fetchWithAuth(
    `${BASE_URL}/auth/github/url?mode=${encodeURIComponent(safeMode)}`,
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.url) {
    throw parseAuthErrorResponse(
      res,
      data,
      "GitHub OAuth is currently unavailable.",
    );
  }
  return data.url;
}

/**
 * GET /api/auth/github/callback?code=...&state=...
 */
export async function oAuthGithubApi(code, state = "") {
  const params = new URLSearchParams({ code });
  if (state) params.set("state", state);
  const res = await fetchWithAuth(
    `${BASE_URL}/auth/github/callback?${params.toString()}`,
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw parseAuthErrorResponse(res, data, "GitHub login error");
  }
  return data;
}

/**
 * POST /api/auth/github/connect
 * Links GitHub account to the currently authenticated CovAI user.
 */
export async function connectGithubApi(code, state = "") {
  const res = await fetchWithAuth(`${BASE_URL}/auth/github/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, state }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw parseAuthErrorResponse(res, data, "GitHub connection error");
  }
  return data;
}

/**
 * POST /api/auth/github/confirm-link
 * Confirms linking GitHub identity to an existing local account after verifying password.
 */
export async function confirmGithubLinkApi({ linkToken, password }) {
  const res = await fetchWithAuth(`${BASE_URL}/auth/github/confirm-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ linkToken, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw parseAuthErrorResponse(
      res,
      data,
      "Unable to link GitHub account. Please try again.",
    );
  }
  return data;
}

/**
 * POST /api/auth/github/cancel-link
 */
export async function cancelGithubLinkApi(linkToken) {
  if (!linkToken) return { success: true };
  const res = await fetchWithAuth(`${BASE_URL}/auth/github/cancel-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ linkToken }),
  });
  return res.json().catch(() => ({}));
}

export async function forgotPasswordApi(email) {
  const res = await fetchWithAuth(`${BASE_URL}/auth/forgotPassword`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw parseAuthErrorResponse(res, data, "Request failed!");
  }
  return data;
}

export async function resetPasswordApi(token, newPassword) {
  const res = await fetchWithAuth(`${BASE_URL}/auth/resetPassword/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newPassword }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw parseAuthErrorResponse(res, data, "Update failed!");
  }
  return data;
}
