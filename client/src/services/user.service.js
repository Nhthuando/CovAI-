import {
  API_BASE,
  authAwareFetch,
  getAccessToken,
} from "../lib/authSession.js";

const BASE_URL = API_BASE;

export async function getUserProfileApi() {
  const token = getAccessToken();
  const res = await authAwareFetch(fetch, `${BASE_URL}/users/me`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error("Failed to fetch user profile");
  }

  return await res.json();
}

export async function updateUserProfileApi(userData) {
  const token = getAccessToken();
  const res = await authAwareFetch(fetch, `${BASE_URL}/users/me`, {
    method: "PATCH",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(userData),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    const errorMessage =
      errorData?.error?.name?.[0] ||
      errorData?.message ||
      "Failed to update user profile";
    const err = new Error(errorMessage);
    err.data = errorData;
    throw err;
  }

  return await res.json();
}
