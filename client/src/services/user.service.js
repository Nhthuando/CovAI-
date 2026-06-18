const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

export async function getUserProfileApi() {
  const token = localStorage.getItem("token");
  const res = await fetch(`${BASE_URL}/users/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error("Failed to fetch user profile");
  }

  return await res.json();
}
