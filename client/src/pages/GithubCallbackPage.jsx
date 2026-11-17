<<<<<<< HEAD
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { oAuthGithubApi, connectGithubApi } from "../services/auth.service";
import { Loader2, AlertCircle, ArrowLeft } from "lucide-react";
=======
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { oAuthGithubApi } from "../services/auth.service";
import { Loader2 } from "lucide-react";
>>>>>>> 56795b36d270ed9b0369125739735bccf44396c1
import { consumeAuthReturn } from "../lib/authReturn";
import { queryClient } from "../lib/queryClient";
import Button from "../components/common/Button";

// Deduplicate OAuth code exchanges across React StrictMode or unexpected remounts
const inFlightOAuthRequests = new Map();

function safeConnectReturnPath() {
  const stored = sessionStorage.getItem("covai.githubConnectReturn");
  if (
    typeof stored === "string" &&
    stored.startsWith("/") &&
    !stored.startsWith("//")
  ) {
    return stored;
  }
  return "/projects";
}

function getOrCreateOAuthTask(code, isConnectMode) {
  if (inFlightOAuthRequests.has(code)) {
    return inFlightOAuthRequests.get(code);
  }
  const mode = isConnectMode ? "connect" : "login";
  const returnPath = isConnectMode ? safeConnectReturnPath() : null;
  sessionStorage.removeItem("covai.githubOAuthMode");
  sessionStorage.removeItem("covai.githubConnectReturn");

  const promise = (
    mode === "connect" ? connectGithubApi(code) : oAuthGithubApi(code)
  ).finally(() => {
    setTimeout(() => inFlightOAuthRequests.delete(code), 5000);
  });

  const task = { mode, returnPath, promise };
  inFlightOAuthRequests.set(code, task);
  return task;
}

// Module-level guard to ensure a GitHub code is only exchanged once in the browser runtime
const consumedCodes = new Set();

export default function GithubCallbackPage() {
  const navigate = useNavigate();
<<<<<<< HEAD
  const [asyncErrorState, setAsyncErrorState] = useState(null);

  const code = searchParams.get("code");
  const errorParam = searchParams.get("error");
  const oauthState = searchParams.get("state");
  const storedMode = sessionStorage.getItem("covai.githubOAuthMode");
  const hasToken = Boolean(localStorage.getItem("token"));
  const isConnectMode =
    (oauthState === "connect" || storedMode === "connect") && hasToken;

  const errorState =
    errorParam === "access_denied"
      ? {
          mode: isConnectMode ? "connect" : "login",
          returnPath: isConnectMode ? safeConnectReturnPath() : "/login",
          message: "You declined GitHub access permission.",
        }
      : asyncErrorState;

  useEffect(() => {
    let active = true;

    if (errorParam === "access_denied") {
      sessionStorage.removeItem("covai.githubOAuthMode");
      sessionStorage.removeItem("covai.githubConnectReturn");
      return () => {
        active = false;
      };
    }

    if (!code) {
      navigate(isConnectMode ? "/projects" : "/login", { replace: true });
      return () => {
        active = false;
      };
    }

    // Clear the code from the address bar to avoid accidental reuse on manual refresh
    window.history.replaceState({}, document.title, "/auth/github/callback");

    const task = getOrCreateOAuthTask(code, isConnectMode);
    task.promise
      .then((data) => {
        if (!active) return;

        if (task.mode === "connect") {
          queryClient.invalidateQueries();
          navigate(task.returnPath || "/projects", {
            replace: true,
            state: { openImport: true, githubConnected: true },
          });
          return;
        }

=======
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
>>>>>>> 56795b36d270ed9b0369125739735bccf44396c1
        const userPayload = {
          id: data.userId || data.id,
          name: data.name,
          email: data.email,
          token: data.token,
        };
        localStorage.setItem("token", data.token);
        localStorage.setItem("user", JSON.stringify(userPayload));
<<<<<<< HEAD
        localStorage.setItem("userName", data.name || "");
        localStorage.setItem("userEmail", data.email || "");
        window.dispatchEvent(new Event("covai:auth-change"));
=======
        localStorage.setItem("userName", data.name);
        localStorage.setItem("userEmail", data.email);
>>>>>>> 56795b36d270ed9b0369125739735bccf44396c1
        queryClient.clear();
        navigate(consumeAuthReturn(), { replace: true });
      })
      .catch((err) => {
<<<<<<< HEAD
        if (!active) return;
        setAsyncErrorState({
          mode: task.mode,
          returnPath:
            task.returnPath ||
            (task.mode === "connect" ? "/projects" : "/login"),
          message: err?.message || "GitHub authentication failed.",
        });
      });

    return () => {
      active = false;
    };
  }, [code, errorParam, isConnectMode, navigate]);

  if (errorState) {
    const isConnect = errorState.mode === "connect";
    return (
      <div className="h-screen flex items-center justify-center p-4 bg-[var(--color-bg)] text-[var(--color-text)] font-sans">
        <div className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/25 flex items-center justify-center text-[var(--color-danger)] shrink-0">
              <AlertCircle size={18} />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-[var(--color-text)]">
                {isConnect ? "GitHub Connection Failed" : "GitHub Login Failed"}
              </h1>
              <p className="text-xs text-[var(--color-text-secondary)] mt-1 leading-relaxed break-words">
                {errorState.message}
              </p>
            </div>
          </div>

          <div className="flex justify-end pt-2 border-t border-[var(--color-border)]">
            <Button
              type="button"
              variant="primary"
              size="sm"
              icon={ArrowLeft}
              onClick={() =>
                navigate(errorState.returnPath, {
                  replace: true,
                  state: isConnect ? { openImport: true } : undefined,
                })
              }
            >
              {isConnect ? "Back to Projects" : "Back to Login"}
            </Button>
          </div>
        </div>
      </div>
    );
  }
=======
        alert("GitHub login error: " + err.message);
        navigate("/login", { replace: true });
      });
  }, [navigate]);
>>>>>>> 56795b36d270ed9b0369125739735bccf44396c1

  return (
    <div className="h-screen flex items-center justify-center flex-col gap-4 bg-[var(--color-bg)] text-[var(--color-text)] font-sans">
      <Loader2 size={32} className="animate-spin text-[var(--color-primary)]" />
      <span className="text-sm font-medium text-[var(--color-text-secondary)]">
        Authenticating with GitHub...
      </span>
    </div>
  );
}
