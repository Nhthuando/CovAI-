// Shared access-token session handling.
// The API issues 15-minute access tokens plus an HttpOnly refresh cookie.
// Long System Test runs and active/idle dashboards outlive the access token, so
// every HTTP client and socket must renew it instead of logging the user out.
const LOCAL_DEV_API_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/api\/?$/i;

export function resolveApiBaseUrl() {
  const configured =
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) ||
    "http://localhost:5000/api";
  const isDev = Boolean(typeof import.meta !== "undefined" && import.meta.env?.DEV);
  if (isDev && typeof window !== "undefined" && LOCAL_DEV_API_RE.test(configured)) {
    // Route local dev requests through Vite's same-origin /api proxy so HttpOnly
    // cookies work consistently across localhost, 127.0.0.1, [::1], and Docker.
    return "/api";
  }
  return configured.replace(/\/+$/, "");
}

export const API_BASE = resolveApiBaseUrl();
const AUTH_KEYS = ["token", "user", "userName", "userEmail"];
const RENEW_BEFORE_MS = 3 * 60 * 1000;
const ACTIVITY_THROTTLE_MS = 30 * 1000;
const REFRESH_COOLDOWN_MS = 15 * 1000;
const AUTH_ENDPOINT = /\/(auth\/(login|register|forgotPassword|resetPassword|github\/(url|callback|confirm-link|cancel-link))|refresh)(\/|\?|$)/;

let inflightRefresh = null;
let keepAliveStarted = false;
let lastRefreshAttemptAt = 0;

export function getAccessToken() {
  const token = localStorage.getItem("token");
  if (token) return token;
  try {
    return JSON.parse(localStorage.getItem("user") || "null")?.token || null;
  } catch (error) {
    console.error("[auth] Stored user is not valid JSON:", error);
    return null;
  }
}

export function setStoredAccessToken(accessToken) {
  if (!accessToken) return;
  localStorage.setItem("token", accessToken);
  try {
    const rawUser = localStorage.getItem("user");
    if (rawUser) {
      const parsed = JSON.parse(rawUser);
      if (parsed && typeof parsed === "object" && parsed.token !== accessToken) {
        parsed.token = accessToken;
        localStorage.setItem("user", JSON.stringify(parsed));
      }
    }
  } catch (error) {
    console.error("[auth] Failed to sync refreshed token to stored user:", error);
  }
  window.dispatchEvent(new CustomEvent("covai:token-refreshed", { detail: { token: accessToken } }));
}

function decodeAccessTokenPayload(token = getAccessToken()) {
  if (!token) return null;
  try {
    return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch (error) {
    console.error("[auth] Access token payload could not be decoded:", error);
    return null;
  }
}

export function accessTokenExpiresAt(token = getAccessToken()) {
  const payload = decodeAccessTokenPayload(token);
  return typeof payload?.exp === "number" ? payload.exp * 1000 : null;
}

export function computeRenewBeforeMs(token = getAccessToken()) {
  const payload = decodeAccessTokenPayload(token);
  if (typeof payload?.exp === "number" && typeof payload?.iat === "number") {
    const lifetimeMs = Math.max(0, (payload.exp - payload.iat) * 1000);
    if (lifetimeMs > 0) {
      return Math.min(RENEW_BEFORE_MS, Math.max(15 * 1000, Math.floor(lifetimeMs * 0.25)));
    }
  }
  return RENEW_BEFORE_MS;
}

export function clearAuthState() {
  for (const key of AUTH_KEYS) localStorage.removeItem(key);
}

export function redirectToLogin() {
  clearAuthState();
  if (!window.location.pathname.startsWith("/login")) window.location.assign("/login");
}

export const isAuthEndpoint = (url = "") => AUTH_ENDPOINT.test(String(url));

async function requestTokenRefreshOnce() {
  const response = await fetch(`${API_BASE}/refresh`, { method: "POST", credentials: "include" });
  if (response.status === 401 || response.status === 403) {
    return { token: null, invalidSession: true, status: response.status };
  }
  if (!response.ok) {
    return { token: null, invalidSession: false, status: response.status };
  }
  const data = await response.json().catch(() => ({}));
  if (!data?.accessToken) {
    return { token: null, invalidSession: false, status: response.status };
  }
  setStoredAccessToken(data.accessToken);
  return { token: data.accessToken, invalidSession: false, status: response.status };
}

// One refresh request at a time: concurrent 401s share the same renewal.
// Distinguishes explicit invalid/expired refresh sessions (401/403) from
// transient network/5xx glitches so active users are never logged out by a blip.
export function refreshAccessTokenWithStatus() {
  if (inflightRefresh) return inflightRefresh;
  inflightRefresh = (async () => {
    try {
      const first = await requestTokenRefreshOnce();
      if (first.token || first.invalidSession) return first;

      // Retry once after brief backoff on transient 5xx/429 responses
      await new Promise((resolve) => setTimeout(resolve, 400));
      return await requestTokenRefreshOnce();
    } catch (error) {
      console.error("[auth] Token refresh failed (transient):", error);
      try {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return await requestTokenRefreshOnce();
      } catch (retryError) {
        console.error("[auth] Token refresh retry failed:", retryError);
        return { token: null, invalidSession: false, status: 0 };
      }
    }
  })();
  inflightRefresh.finally(() => { inflightRefresh = null; });
  return inflightRefresh;
}

export async function refreshAccessToken() {
  const { token } = await refreshAccessTokenWithStatus();
  return token;
}

// For fetch-based helpers that cannot replay the request themselves: renew the
// session when possible (the caller's next poll or retry succeeds), and only
// send the user to login when the refresh session itself is invalid/expired.
export async function handleUnauthorizedResponse() {
  const { token, invalidSession } = await refreshAccessTokenWithStatus();
  if (!token && invalidSession) redirectToLogin();
  return token;
}

function normalizeHeaders(rawHeaders) {
  if (!rawHeaders) return {};
  if (typeof Headers !== "undefined" && rawHeaders instanceof Headers) {
    return Object.fromEntries(rawHeaders.entries());
  }
  if (Array.isArray(rawHeaders)) {
    return Object.fromEntries(rawHeaders);
  }
  return { ...rawHeaders };
}

// Fetch wrapper that transparently refreshes expired access tokens on 401 and
// replays the request once with the renewed Bearer token.
export async function authAwareFetch(fetchImpl, input, init = {}) {
  const baseFetch = typeof fetchImpl === "function" ? fetchImpl : fetch;
  const headers = normalizeHeaders(init.headers);
  if (!headers.Authorization && !headers.authorization) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const credentials = init.credentials ?? "include";
  let response = await baseFetch(input, { ...init, headers, credentials });
  if (response.status === 401 && !init._covaiAuthRetry && !isAuthEndpoint(String(input))) {
    const { token, invalidSession } = await refreshAccessTokenWithStatus();
    if (token) {
      const retryHeaders = { ...headers };
      delete retryHeaders.authorization;
      retryHeaders.Authorization = `Bearer ${token}`;
      response = await baseFetch(input, {
        ...init,
        headers: retryHeaders,
        credentials,
        _covaiAuthRetry: true,
      });
    } else if (invalidSession) {
      redirectToLogin();
    }
  }
  return response;
}

export function installAxiosAuthRefresh(instance) {
  instance.interceptors.request.use((config) => {
    const token = getAccessToken();
    if (token && config?.headers) {
      const hasAuth = config.headers.Authorization || config.headers.authorization || config.headers.get?.("Authorization");
      if (!hasAuth) {
        if (typeof config.headers.set === "function") config.headers.set("Authorization", `Bearer ${token}`);
        else config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  });

  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const config = error.config;
      if (error.response?.status !== 401 || !config || config._covaiAuthRetry || isAuthEndpoint(config.url)) {
        return Promise.reject(error);
      }
      config._covaiAuthRetry = true;
      const { token, invalidSession } = await refreshAccessTokenWithStatus();
      if (!token) {
        if (invalidSession) redirectToLogin();
        return Promise.reject(error);
      }
      if (config.headers?.set) config.headers.set("Authorization", `Bearer ${token}`);
      else config.headers = { ...(config.headers || {}), Authorization: `Bearer ${token}` };
      return instance(config);
    },
  );
}

// Renew shortly before expiry, when a sleeping tab wakes up, and during active user interaction.
export function startSessionKeepAlive() {
  if (keepAliveStarted) return;
  keepAliveStarted = true;
  let lastActivityCheck = 0;

  const renewIfDue = () => {
    const token = getAccessToken();
    if (!token) return;
    const expiresAt = accessTokenExpiresAt(token);
    const renewBefore = computeRenewBeforeMs(token);
    if (expiresAt && expiresAt - Date.now() < renewBefore) {
      const now = Date.now();
      if (now - lastRefreshAttemptAt < REFRESH_COOLDOWN_MS) return;
      lastRefreshAttemptAt = now;
      void refreshAccessTokenWithStatus();
    }
  };

  const renewOnActivity = () => {
    const now = Date.now();
    if (now - lastActivityCheck < ACTIVITY_THROTTLE_MS) return;
    lastActivityCheck = now;
    renewIfDue();
  };

  window.setInterval(renewIfDue, 30 * 1000);
  window.addEventListener("focus", renewIfDue);
  window.addEventListener("online", renewIfDue);
  window.addEventListener("covai:auth-change", renewIfDue);
  window.addEventListener("pointerdown", renewOnActivity, { passive: true });
  window.addEventListener("keydown", renewOnActivity, { passive: true });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) renewIfDue(); });
  renewIfDue();
}

// Socket.IO calls this on every (re)connect, so reconnects use the newest token.
export const socketAuth = (callback) => callback({ token: getAccessToken() });

// Socket.IO does not retry by itself after the server middleware rejects an
// expired token. Renew the token once and reconnect.
export function attachSocketAuthRecovery(socket) {
  let recovering = false;
  socket.on("connect_error", async (error) => {
    if (recovering || !/auth|token|jwt|unauthor/i.test(error?.message || "")) return;
    recovering = true;
    const { token } = await refreshAccessTokenWithStatus();
    recovering = false;
    if (token && !socket.connected) socket.connect();
  });
  return socket;
}
