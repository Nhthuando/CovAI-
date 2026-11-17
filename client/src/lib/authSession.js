// Shared access-token session handling.
// The API issues 15-minute access tokens plus an HttpOnly refresh cookie.
// Long System Test runs and idle dashboards outlive the access token, so every
// HTTP client and socket must renew it instead of logging the user out.
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
const AUTH_KEYS = ["token", "user", "userName", "userEmail"];
const RENEW_BEFORE_MS = 2 * 60 * 1000;
const AUTH_ENDPOINT = /\/(auth\/(login|register|github|forgotPassword|resetPassword)|refresh)(\/|\?|$)/;

let inflightRefresh = null;
let keepAliveStarted = false;

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

export function accessTokenExpiresAt(token = getAccessToken()) {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch (error) {
    console.error("[auth] Access token payload could not be decoded:", error);
    return null;
  }
}

export function clearAuthState() {
  for (const key of AUTH_KEYS) localStorage.removeItem(key);
}

export function redirectToLogin() {
  clearAuthState();
  if (!window.location.pathname.startsWith("/login")) window.location.assign("/login");
}

export const isAuthEndpoint = (url = "") => AUTH_ENDPOINT.test(String(url));

// One refresh request at a time: concurrent 401s share the same renewal.
export function refreshAccessToken() {
  if (inflightRefresh) return inflightRefresh;
  inflightRefresh = (async () => {
    try {
      const response = await fetch(`${API_BASE}/refresh`, { method: "POST", credentials: "include" });
      if (!response.ok) return null;
      const { accessToken } = await response.json();
      if (!accessToken) return null;
      localStorage.setItem("token", accessToken);
      window.dispatchEvent(new CustomEvent("covai:token-refreshed", { detail: { token: accessToken } }));
      return accessToken;
    } catch (error) {
      console.error("[auth] Token refresh failed:", error);
      return null;
    }
  })();
  inflightRefresh.finally(() => { inflightRefresh = null; });
  return inflightRefresh;
}

// For fetch-based helpers that cannot replay the request themselves: renew the
// session when possible (the caller's next poll or retry succeeds), otherwise
// send the user to the login page.
export async function handleUnauthorizedResponse() {
  const token = await refreshAccessToken();
  if (!token) redirectToLogin();
  return token;
}

export function installAxiosAuthRefresh(instance) {
  instance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const config = error.config;
      if (error.response?.status !== 401 || !config || config._covaiAuthRetry || isAuthEndpoint(config.url)) {
        return Promise.reject(error);
      }
      config._covaiAuthRetry = true;
      const token = await refreshAccessToken();
      if (!token) {
        redirectToLogin();
        return Promise.reject(error);
      }
      if (config.headers?.set) config.headers.set("Authorization", `Bearer ${token}`);
      else config.headers = { ...(config.headers || {}), Authorization: `Bearer ${token}` };
      return instance(config);
    },
  );
}

// Renew shortly before expiry, and right away when a sleeping tab wakes up.
export function startSessionKeepAlive() {
  if (keepAliveStarted) return;
  keepAliveStarted = true;
  const renewIfDue = () => {
    const expiresAt = accessTokenExpiresAt();
    if (expiresAt && expiresAt - Date.now() < RENEW_BEFORE_MS) void refreshAccessToken();
  };
  window.setInterval(renewIfDue, 60 * 1000);
  window.addEventListener("focus", renewIfDue);
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
    const token = await refreshAccessToken();
    recovering = false;
    if (token && !socket.connected) socket.connect();
  });
  return socket;
}
