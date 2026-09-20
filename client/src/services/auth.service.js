import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

async function fetchWithAuth(input, init = {}) {
  const token = localStorage.getItem("token");
  const headers = {
    ...init.headers,
    Authorization: token ? `Bearer ${token}` : "",
  };

  let response = await fetch(input, { ...init, headers });

  if (response.status === 401 && !init._retry) {
    // Refresh the access token using the refresh token
    try {
      const refreshResponse = await fetch(`${BASE_URL}/refresh`, {
        method: "POST",
        credentials: "include", // Include cookies for refresh token
      });
      if (refreshResponse.ok) {
        const { accessToken } = await refreshResponse.json();
        localStorage.setItem("token", accessToken);

        // Retry the original request with the new token
        response = await fetch(input, {
          ...init,
          headers: { ...headers, Authorization: `Bearer ${accessToken}` },
          _retry: true,
        });
      } else {
        localStorage.removeItem("token");
        window.location.href = "/login";
      }
    } catch (error) {
      console.error("Token refresh failed:", error);
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
  }

  return response;
}

/**
 * POST /api/auth/register
 * Body: { name, email, password }
 * Success 201: { message, userName, userEmail }
 * Error 400:  { error: { name?, email?, password? } }  (Zod field errors)
 *        400:  { message: "Tài khoản đã tồn tại!" }
 */
const httpClient = axios.create({ baseURL: BASE_URL });
httpClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const { data } = await httpClient.post(
          "/refresh",
          {},
          { withCredentials: true },
        );
        localStorage.setItem("token", data.accessToken);
        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        return httpClient(originalRequest);
      } catch (refreshError) {
        console.error(refreshError);
        localStorage.removeItem("token");
        window.location.href = "/login";
      }
    }

    return Promise.reject(error);
  },
);

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
    throw { type: "message", message: data.message || "Đăng ký thất bại!" };
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
    throw { type: "message", message: data.message || "Đăng nhập thất bại!" };
  }

  return data; // { message, token, name, email }
}

/**
 * GET /api/auth/github/callback?code=...
 */
export async function oAuthGithubApi(code) {
  const res = await fetchWithAuth(
    `${BASE_URL}/auth/github/callback?code=${code}`,
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || "Lỗi đăng nhập GitHub");
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
    throw { type: "message", message: data.message || "Yêu cầu thất bại!" };
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
    throw { type: "message", message: data.message || "Cập nhật thất bại!" };
  }
  return data;
}
