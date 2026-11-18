import axios from "axios";
import { getAccessToken, isAuthEndpoint, installAxiosAuthRefresh, redirectToLogin, refreshAccessToken } from "../lib/authSession.js";

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
    const accessToken = await refreshAccessToken();
    if (accessToken) {
      response = await fetch(input, {
        ...init,
        headers: { ...headers, Authorization: `Bearer ${accessToken}` },
        credentials: "include",
        _retry: true,
      });
    } else {
      redirectToLogin();
    }
  }

  return response;
}

/**
 * POST /api/auth/register
 * Body: { name, email, password }
 * Success 201: { message, userName, userEmail }
 * Error 400:  { error: { name?, email?, password? } }  (Zod field errors)
 *        400:  { message: "Account already exists!" }
 */
const httpClient = axios.create({ baseURL: BASE_URL });
installAxiosAuthRefresh(httpClient);

export async function registerApi({ name, email, password }) {
  const res = await fetchWithAuth(`${BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  });

  const data = await res.json();

  if (!res.ok) {
    // { error: { email: [...], password: [...] } } — Zod field errors
    if (data.error && typeof data.error === "object") {
      const fieldErrors = {};
      for (const [key, msgs] of Object.entries(data.error)) {
        fieldErrors[key] = Array.isArray(msgs) ? msgs[0] : msgs;
      }
      throw { type: "field", errors: fieldErrors };
    }
    // { message: "..." } — single message error
    throw { type: "message", message: data.message || "Registration failed!" };
  }

  return data; // { message, userName, userEmail }
}

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Success 200: { message, token, name, email }
 * Error 400:   { error: { ... } } or { message: "..." }
 */
export async function loginApi({ email, password }) {
  const res = await fetchWithAuth(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json();

  if (!res.ok) {
    if (data.error && typeof data.error === "object") {
      const fieldErrors = {};
      for (const [key, msgs] of Object.entries(data.error)) {
        fieldErrors[key] = Array.isArray(msgs) ? msgs[0] : msgs;
      }
      throw { type: "field", errors: fieldErrors };
    }
    throw { type: "message", message: data.message || "Login failed!" };
  }

  return data; // { message, token, name, email }
}

/**
 * Build GitHub OAuth authorize URL for login or linking an existing account.
 * @param {"login"|"connect"} mode
 */
export function getGithubOAuthUrl(mode = "login") {
  const clientId =
    import.meta.env.VITE_GITHUB_CLIENT_ID ||
    (mode === "login" ? "Ov23liQyAORXbj6NeqAB" : "");
  if (!clientId) return null;

  const redirectUri = `${window.location.origin}/auth/github/callback`;
  const scope = mode === "connect" ? "repo,user:email" : "user:email repo";
  const params = new URLSearchParams({
    client_id: clientId,
    scope,
    redirect_uri: redirectUri,
    state: mode,
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

/**
 * GET /api/auth/github/callback?code=...
 */
export async function oAuthGithubApi(code) {
  const res = await fetchWithAuth(
    `${BASE_URL}/auth/github/callback?code=${encodeURIComponent(code)}`,
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || "GitHub login error");
  }
  return data;
}

/**
 * POST /api/auth/github/connect
 * Links GitHub account to the currently authenticated CovAI user.
 */
export async function connectGithubApi(code) {
  const res = await fetchWithAuth(`${BASE_URL}/auth/github/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || "GitHub connection error");
  }
  return data;
}

/**
 * POST /api/auth/forgotPassword
 * Body: { email }
 */
export async function forgotPasswordApi(email) {
  const res = await fetchWithAuth(`${BASE_URL}/auth/forgotPassword`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw { type: "message", message: data.message || "Request failed!" };
  }
  return data;
}

/**
 * POST /api/auth/resetPassword/:token
 * Body: { newPassword }
 */
export async function resetPasswordApi(token, newPassword) {
  const res = await fetchWithAuth(`${BASE_URL}/auth/resetPassword/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newPassword }),
  });
  const data = await res.json();

  if (!res.ok) {
    if (data.error && typeof data.error === "object") {
      const fieldErrors = {};
      for (const [key, msgs] of Object.entries(data.error)) {
        fieldErrors[key] = Array.isArray(msgs) ? msgs[0] : msgs;
      }
      throw { type: "field", errors: fieldErrors };
    }
    throw { type: "message", message: data.message || "Update failed!" };
  }
  return data;
}
