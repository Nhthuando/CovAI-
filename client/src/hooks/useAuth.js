import { useState, useEffect, useCallback } from "react";
import { queryClient } from "../lib/queryClient";
import { API_BASE } from "../lib/authSession";
import {
  AUTH_PROVIDERS,
  normalizeAuthProvider,
  resolveVersionControlMode,
} from "../../../shared/versionControlMode.js";
import { resetGuidanceTours } from "../components/dashboard/guidance/guidanceStorage";

function readUserFromStorage() {
  const token = localStorage.getItem("token");
  if (!token) return null;

  try {
    const base64Url = token.split(".")[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64));

    let storedUser = null;
    try {
      storedUser = JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      storedUser = null;
    }

    const authProvider =
      normalizeAuthProvider(payload.authProvider) ||
      normalizeAuthProvider(storedUser?.authProvider) ||
      AUTH_PROVIDERS.EMAIL;
    const vcMode = resolveVersionControlMode(authProvider);

    return {
      id: payload.userId,
      email: payload.userEmail || localStorage.getItem("userEmail"),
      name: payload.userName || localStorage.getItem("userName"),
      authProvider,
      vcMode,
      githubLogin: storedUser?.githubLogin || null,
      githubScopes: Array.isArray(storedUser?.githubScopes)
        ? storedUser.githubScopes
        : [],
      hasGithubRepoWriteScope: Boolean(storedUser?.hasGithubRepoWriteScope),
      token,
    };
  } catch (e) {
    console.error("Failed to decode token:", e);
    return null;
  }
}

export const useAuth = () => {
  const [user, setUser] = useState(() => readUserFromStorage());
  const [isLoading, setIsLoading] = useState(false);

  const loadUserFromStorage = useCallback(() => {
    setUser(readUserFromStorage());
    setIsLoading(false);
  }, []);

  const login = useCallback((userData, token) => {
    queryClient.cancelQueries();
    queryClient.clear();
    resetGuidanceTours();
    const authProvider =
      normalizeAuthProvider(userData?.authProvider) || AUTH_PROVIDERS.EMAIL;
    const vcMode = resolveVersionControlMode(authProvider);
    const enrichedUser = {
      ...userData,
      authProvider,
      vcMode,
      token,
    };
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(enrichedUser));
    setUser(enrichedUser);
    window.dispatchEvent(new Event("covai:auth-change"));
  }, []);

  const logout = useCallback(() => {
    const token = localStorage.getItem("token");
    if (token) {
      fetch(`${API_BASE}/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: { Authorization: `Bearer ${token}` },
      }).catch((err) => {
        console.warn("[useAuth] Logout request warning:", err);
      });
    }
    queryClient.cancelQueries();
    queryClient.clear();
    resetGuidanceTours();
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("userName");
    localStorage.removeItem("userEmail");
    Object.keys(localStorage)
      .filter((key) => key.startsWith("latestSnapshot_"))
      .forEach((key) => localStorage.removeItem(key));
    Object.keys(sessionStorage)
      .filter(
        (key) =>
          key.startsWith("covai_running_processes") ||
          key.startsWith("covai_snapshot_suggestions_"),
      )
      .forEach((key) => sessionStorage.removeItem(key));
    window.dispatchEvent(new Event("covai:auth-change"));

    // Clear any other potential auth keys if they exist
    // Ensure state is fully reset
    setUser(null);

    // Force reload or redirect handled by component using useAuth
  }, []);

  useEffect(() => {
    const handleStorageChange = (event) => {
      if (
        event &&
        event.key !== null &&
        event.key !== "token" &&
        event.key !== "user"
      ) {
        return;
      }
      const nextUser = readUserFromStorage();
      setUser((prevUser) => {
        const identityChanged =
          (prevUser?.id || null) !== (nextUser?.id || null);
        if (identityChanged || !nextUser) {
          queryClient.cancelQueries();
          queryClient.clear();
        }
        return nextUser;
      });
      setIsLoading(false);
    };
    const handleTokenRefreshed = () => {
      setUser(readUserFromStorage());
    };
    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("covai:auth-change", handleStorageChange);
    window.addEventListener("covai:token-refreshed", handleTokenRefreshed);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("covai:auth-change", handleStorageChange);
      window.removeEventListener("covai:token-refreshed", handleTokenRefreshed);
    };
  }, []);

  const authProvider = user?.authProvider || null;
  const vcMode = user ? resolveVersionControlMode(authProvider) : null;

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    userId: user?.id,
    token: user?.token,
    authProvider,
    vcMode,
    isGitHubSession: authProvider === AUTH_PROVIDERS.GITHUB,
    isEmailSession: Boolean(user) && authProvider !== AUTH_PROVIDERS.GITHUB,
    login,
    logout,
    refresh: loadUserFromStorage,
  };
};
