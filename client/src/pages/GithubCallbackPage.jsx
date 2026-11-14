import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { oAuthGithubApi } from "../services/auth.service";
import { Loader2 } from "lucide-react";
import { consumeAuthReturn } from "../lib/authReturn";
import { queryClient } from "../lib/queryClient";

// Module-level guard to ensure a GitHub code is only exchanged once in the browser runtime
const consumedCodes = new Set();

export default function GithubCallbackPage() {
  const navigate = useNavigate();
  const calledRef = useRef(false);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const code = searchParams.get("code");
    const error = searchParams.get("error");

    if (error === "access_denied") {
      alert("You declined GitHub access permission.");
      navigate("/login", { replace: true });
      return;
    }

    if (!code) {
      navigate("/login", { replace: true });
      return;
    }

    // 1. Component instance ref guard (StrictMode double-mount)
    // 2. Runtime Set guard (Component remount / re-renders)
    if (calledRef.current || consumedCodes.has(code)) {
      return;
    }
    calledRef.current = true;
    consumedCodes.add(code);

    // 3. SessionStorage guard (Hard browser reload with code still in address bar)
    const sessionKey = `covai_gh_code_${code}`;
    if (sessionStorage.getItem(sessionKey)) {
      return;
    }
    sessionStorage.setItem(sessionKey, "1");

    // Clear the code from the URL for better UX and preventing shoulder-surfing
    window.history.replaceState({}, document.title, "/auth/github/callback");

    oAuthGithubApi(code)
      .then((data) => {
        const userPayload = {
          id: data.userId || data.id,
          name: data.name,
          email: data.email,
          token: data.token,
        };
        localStorage.setItem("token", data.token);
        localStorage.setItem("user", JSON.stringify(userPayload));
        localStorage.setItem("userName", data.name);
        localStorage.setItem("userEmail", data.email);
        queryClient.clear();
        navigate(consumeAuthReturn(), { replace: true });
      })
      .catch((err) => {
        alert("GitHub login error: " + err.message);
        navigate("/login", { replace: true });
      });
  }, [navigate]);

  return (
    <div className="h-screen flex items-center justify-center flex-col gap-4 bg-[var(--color-bg)] text-[var(--color-text)] font-sans">
      <Loader2 size={32} className="animate-spin text-[var(--color-primary)]" />
      <span className="text-sm font-medium text-[var(--color-text-secondary)]">
        Authenticating with GitHub...
      </span>
    </div>
  );
}
