// Shared access-token session handling.
// The API issues 15-minute access tokens plus an HttpOnly refresh cookie.
// Long System Test runs and active/idle dashboards outlive the access token, so
// every HTTP client and socket must renew it instead of logging the user out.
import {
  AUTH_PROVIDERS,
  normalizeAuthProvider,
  resolveVersionControlMode,
} from "../../../shared/versionControlMode.js";
import { rememberAuthReturn } from "./authReturn.js";

const LOCAL_DEV_API_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/api\/?$/i;

function stripWww(hostname = "") {
  return String(hostname).replace(/^www\./i, "").toLowerCase();
}

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
  if (typeof window !== "undefined" && window.location?.hostname && /^https?:\/\//i.test(configured)) {
    try {
      const parsed = new URL(configured);
      const sameOrigin = parsed.origin === window.location.origin;
      const sameRegistrableSiteOnStandardPort =
        !parsed.port &&
        !window.location.port &&
        parsed.protocol === window.location.protocol &&
        stripWww(parsed.hostname) === stripWww(window.location.hostname);
      if ((sameOrigin || sameRegistrableSiteOnStandardPort) && /^\/api\/?$/i.test(parsed.pathname)) {
        return "/api";
      }
    } catch {
      // Fall back to configured URL
    }
  }
  return configured.replace(/\/+$/, "");
}

export function resolveSocketBaseUrl() {
  const explicit =
    typeof import.meta !== "undefined" && import.meta.env?.VITE_SOCKET_URL;
  if (explicit) return String(explicit).replace(/\/+$/, "");

  const configuredApi =
    typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL;
  if (configuredApi && /^https?:\/\//i.test(configuredApi)) {
    const stripped = String(configuredApi)
      .replace(/\/+$/, "")
      .replace(/\/api$/i, "");
    if (
      typeof window !== "undefined" &&
      window.location?.hostname &&
      !/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(window.location.hostname)
    ) {
      try {
        const parsed = new URL(stripped);
        if (stripWww(parsed.hostname) === stripWww(window.location.hostname)) {
          return window.location.origin;
        }
      } catch {
        // Fall back to stripped API origin
      }
    }
    return stripped;
  }

  if (
    typeof window !== "undefined" &&
    window.location?.origin &&
    !/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(window.location.hostname)
  ) {
    return window.location.origin;
  }
  return "http://localhost:5000";
}

export const API_BASE = resolveApiBaseUrl();
export const SOCKET_URL = resolveSocketBaseUrl();
export const AUTH_NOTICE_STORAGE_KEY = "covai.authNotice";

const AUTH_KEYS = ["token", "user", "userName", "userEmail"];
const RENEW_BEFORE_MS = 3 * 60 * 1000;
const ACTIVITY_THROTTLE_MS = 30 * 1000;
const REFRESH_COOLDOWN_MS = 15 * 1000;
const AUTH_ENDPOINT =
  /(?:^|\/api)\/(?:auth\/(?:login|register|forgotPassword|resetPassword|github\/(?:url|callback|confirm-link|cancel-link))|refresh)(?:\/|\?|$)/;

let inflightRefresh = null;
let keepAliveStarted = false;
let lastRefreshAttemptAt = 0;
let scheduledRenewTimer = null;

export function consumeAuthNotice() {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const msg = sessionStorage.getItem(AUTH_NOTICE_STORAGE_KEY);
    if (msg) sessionStorage.removeItem(AUTH_NOTICE_STORAGE_KEY);
    return msg || null;
  } catch {
    return null;
  }
}

function setAuthNotice(message) {
  if (!message) return;
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(AUTH_NOTICE_STORAGE_KEY, message);
    }
  } catch {
    // Ignore storage quota / sandbox restrictions
  }
}

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

export function setStoredAccessToken(accessToken, extra = {}) {
  if (!accessToken) return;
  localStorage.setItem("token", accessToken);
  const decodedProvider = getAccessTokenAuthProvider(accessToken);
  const explicitProvider = normalizeAuthProvider(extra?.authProvider);
  const effectiveProvider = explicitProvider || decodedProvider;
  try {
    const rawUser = localStorage.getItem("user");
    if (rawUser) {
      const parsed = JSON.parse(rawUser);
      if (parsed && typeof parsed === "object") {
        let changed = false;
        if (parsed.token !== accessToken) {
          parsed.token = accessToken;
          changed = true;
        }
        if (effectiveProvider && parsed.authProvider !== effectiveProvider) {
          parsed.authProvider = effectiveProvider;
          parsed.vcMode = resolveVersionControlMode(effectiveProvider);
          changed = true;
        }
        if (changed) {
          localStorage.setItem("user", JSON.stringify(parsed));
        }
      }
    }
  } catch (error) {
    console.error("[auth] Failed to sync refreshed token to stored user:", error);
  }
  window.dispatchEvent(
    new CustomEvent("covai:token-refreshed", {
      detail: {
        token: accessToken,
        authProvider: effectiveProvider,
      },
    }),
  );
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

export function getAccessTokenAuthProvider(token = getAccessToken()) {
  const payload = decodeAccessTokenPayload(token);
  const fromToken = normalizeAuthProvider(payload?.authProvider);
  if (fromToken) return fromToken;
  try {
    const rawUser = localStorage.getItem("user");
    if (rawUser) {
      const fromUser = normalizeAuthProvider(JSON.parse(rawUser)?.authProvider);
      if (fromUser) return fromUser;
    }
  } catch {
    // Ignore invalid JSON in stored user
  }
  return payload ? AUTH_PROVIDERS.EMAIL : null;
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

export function redirectToLogin(options = {}) {
  const hadSession = Boolean(getAccessToken() || localStorage.getItem("user"));
  clearAuthState();
  if (typeof window !== "undefined") {
    try {
      if (window.location?.pathname) {
        rememberAuthReturn(window.location.pathname);
      }
    } catch {
      // Ignore navigation return storage errors
    }
    if (hadSession || options.notice) {
      setAuthNotice(
        options.notice || "Your session has expired. Please sign in again.",
      );
    }
    try {
      window.dispatchEvent(new Event("covai:auth-change"));
    } catch {
      // Ignore synthetic environment without Event constructor
    }
    if (!window.location.pathname.startsWith("/login")) {
      window.location.assign("/login");
    }
  }
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
  setStoredAccessToken(data.accessToken, { authProvider: data.authProvider });
  return { token: data.accessToken, invalidSession: false, status: response.status };
}

// One refresh request at a time: concurrent 401s share the same renewal.
// Distinguishes explicit invalid/expired refresh sessions (401/403) from
// transient network/5xx glitches so active users are never logged out by a blip.
export function refreshAccessTokenWithStatus() {
  if (inflightRefresh) return inflightRefresh;
  inflightRefresh = (async () => {
    const retryDelays = [400, 1200];
    let lastResult = { token: null, invalidSession: false, status: 0 };
    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt - 1]));
      }
      try {
        const result = await requestTokenRefreshOnce();
        if (result.token || result.invalidSession) return result;
        lastResult = result;
      } catch (error) {
        console.error(
          `[auth] Token refresh attempt ${attempt + 1} failed:`,
          error,
        );
        lastResult = { token: null, invalidSession: false, status: 0 };
      }
    }
    return lastResult;
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

function resolveSyncedBearerToken(existingAuthHeader, latestToken) {
  if (!latestToken) return null;
  if (!existingAuthHeader) return latestToken;
  const match = String(existingAuthHeader).match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const providedToken = match[1];
  if (providedToken === latestToken) return latestToken;
  // If localStorage rotated to a newer JWT for the same user while caller was preparing the request, use the latest token.
  const providedPayload = decodeAccessTokenPayload(providedToken);
  const latestPayload = decodeAccessTokenPayload(latestToken);
  if (
    providedPayload?.userId &&
    latestPayload?.userId &&
    providedPayload.userId === latestPayload.userId
  ) {
    return latestToken;
  }
  return null;
}

// Fetch wrapper that transparently refreshes expired access tokens on 401 and
// replays the request once with the renewed Bearer token.
export async function authAwareFetch(fetchImpl, input, init = {}) {
  const baseFetch = typeof fetchImpl === "function" ? fetchImpl : fetch;
  const targetUrl = String(input);
  const authRoute = isAuthEndpoint(targetUrl);

  if (!authRoute && inflightRefresh) {
    await inflightRefresh;
  }

  const headers = normalizeHeaders(init.headers);
  if (!authRoute) {
    const latestToken = getAccessToken();
    const existingAuth = headers.Authorization || headers.authorization;
    const syncedToken = resolveSyncedBearerToken(existingAuth, latestToken);
    if (syncedToken) {
      delete headers.authorization;
      headers.Authorization = `Bearer ${syncedToken}`;
    }
  } else if (!headers.Authorization && !headers.authorization) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const credentials = init.credentials ?? "include";
  let response = await baseFetch(input, { ...init, headers, credentials });
  if (response.status === 401 && !init._covaiAuthRetry && !authRoute) {
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
  instance.interceptors.request.use(async (config) => {
    const authRoute = isAuthEndpoint(config?.url);
    if (!authRoute && inflightRefresh) {
      await inflightRefresh;
    }
    const latestToken = getAccessToken();
    if (latestToken && config?.headers) {
      const existingAuth =
        config.headers.Authorization ||
        config.headers.authorization ||
        config.headers.get?.("Authorization");
      const syncedToken = authRoute
        ? existingAuth ? null : latestToken
        : resolveSyncedBearerToken(existingAuth, latestToken);
      if (syncedToken) {
        if (typeof config.headers.set === "function") {
          config.headers.set("Authorization", `Bearer ${syncedToken}`);
        } else {
          delete config.headers.authorization;
          config.headers.Authorization = `Bearer ${syncedToken}`;
        }
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

  const scheduleNextRenewal = () => {
    if (scheduledRenewTimer) {
      clearTimeout(scheduledRenewTimer);
      scheduledRenewTimer = null;
    }
    const token = getAccessToken();
    if (!token) return;
    const expiresAt = accessTokenExpiresAt(token);
    if (!expiresAt) return;
    const renewBefore = computeRenewBeforeMs(token);
    const delayMs = Math.max(1000, expiresAt - renewBefore - Date.now());
    if (typeof window.setTimeout === "function") {
      scheduledRenewTimer = window.setTimeout(() => {
        scheduledRenewTimer = null;
        renewIfDue(true);
      }, Math.min(delayMs, 15 * 60 * 1000));
    }
  };

  const renewIfDue = (bypassCooldown = false) => {
    const token = getAccessToken();
    if (!token) {
      if (scheduledRenewTimer) {
        clearTimeout(scheduledRenewTimer);
        scheduledRenewTimer = null;
      }
      return;
    }
    const expiresAt = accessTokenExpiresAt(token);
    const renewBefore = computeRenewBeforeMs(token);
    if (expiresAt && expiresAt - Date.now() < renewBefore) {
      const now = Date.now();
      if (!bypassCooldown && now - lastRefreshAttemptAt < REFRESH_COOLDOWN_MS) {
        return;
      }
      lastRefreshAttemptAt = now;
      void refreshAccessTokenWithStatus().then(({ token: nextToken, invalidSession }) => {
        if (nextToken) {
          scheduleNextRenewal();
          return;
        }
        if (invalidSession) {
          const currentToken = getAccessToken();
          if (!currentToken) return;
          const currentExpiresAt = accessTokenExpiresAt(currentToken);
          if (!currentExpiresAt || Date.now() >= currentExpiresAt) {
            redirectToLogin();
          } else if (typeof window.setTimeout === "function") {
            const remainingMs = Math.max(500, currentExpiresAt - Date.now() + 250);
            if (scheduledRenewTimer) clearTimeout(scheduledRenewTimer);
            scheduledRenewTimer = window.setTimeout(() => {
              scheduledRenewTimer = null;
              renewIfDue(true);
            }, remainingMs);
          }
        }
      });
      return;
    }
    scheduleNextRenewal();
  };

  const renewOnActivity = () => {
    const now = Date.now();
    if (now - lastActivityCheck < ACTIVITY_THROTTLE_MS) return;
    lastActivityCheck = now;
    renewIfDue(false);
  };

  window.setInterval(() => renewIfDue(false), 30 * 1000);
  window.addEventListener("focus", () => renewIfDue(false));
  window.addEventListener("online", () => {
    lastRefreshAttemptAt = 0;
    renewIfDue(true);
  });
  window.addEventListener("covai:auth-change", () => {
    lastRefreshAttemptAt = 0;
    renewIfDue(true);
  });
  window.addEventListener("covai:token-refreshed", scheduleNextRenewal);
  window.addEventListener("pointerdown", renewOnActivity, { passive: true });
  window.addEventListener("keydown", renewOnActivity, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) renewIfDue(false);
  });
  renewIfDue(true);
}

// Socket.IO calls this on every (re)connect, renewing an expired token before handshake.
export const socketAuth = async (callback) => {
  let token = getAccessToken();
  if (token) {
    const expiresAt = accessTokenExpiresAt(token);
    if (expiresAt && expiresAt <= Date.now() + 5000) {
      const refreshed = await refreshAccessToken();
      if (refreshed) token = refreshed;
    }
  }
  callback({ token });
};

// Keeps live sockets updated when tokens rotate and recovers from auth errors or expired room subscriptions.
export function attachSocketAuthRecovery(socket, options = {}) {
  const authEventName = options.authEventName || "auth:refresh";
  const onReauthenticated =
    typeof options.onReauthenticated === "function"
      ? options.onReauthenticated
      : null;
  let recovering = false;

  const pushToken = (nextToken) => {
    if (!nextToken || !socket.connected) return;
    socket.emit(authEventName, { token: nextToken }, (ack) => {
      if (ack?.ok && onReauthenticated) {
        onReauthenticated(nextToken);
      }
    });
  };

  const handleTokenRefreshed = (event) => {
    const nextToken = event?.detail?.token || getAccessToken();
    pushToken(nextToken);
  };

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    socket.on("connect", () => {
      window.removeEventListener("covai:token-refreshed", handleTokenRefreshed);
      window.addEventListener("covai:token-refreshed", handleTokenRefreshed);
    });
    socket.on("disconnect", () => {
      window.removeEventListener("covai:token-refreshed", handleTokenRefreshed);
    });
    if (socket.connected) {
      window.addEventListener("covai:token-refreshed", handleTokenRefreshed);
    }
  }

  const recoverAuth = async (preferReconnect = false) => {
    if (recovering) return;
    recovering = true;
    try {
      const { token, invalidSession } = await refreshAccessTokenWithStatus();
      if (!token) {
        if (invalidSession) redirectToLogin();
        return;
      }
      if (socket.connected && !preferReconnect) {
        pushToken(token);
      } else if (!socket.connected) {
        socket.connect();
      }
    } finally {
      recovering = false;
    }
  };

  socket.on("auth:expired", () => {
    void recoverAuth(false);
  });

  socket.on("connect_error", (error) => {
    if (!/auth|token|jwt|unauthor/i.test(error?.message || "")) return;
    void recoverAuth(true);
  });

  return socket;
}
