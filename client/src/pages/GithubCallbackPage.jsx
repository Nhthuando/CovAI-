import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  oAuthGithubApi,
  connectGithubApi,
  confirmGithubLinkApi,
  cancelGithubLinkApi,
} from "../services/auth.service";
import {
  Loader2,
  AlertCircle,
  ArrowLeft,
  Link2,
  Lock,
  Eye,
  EyeOff,
  ShieldAlert,
} from "lucide-react";
import { consumeAuthReturn } from "../lib/authReturn";
import { getAccessToken, refreshAccessToken } from "../lib/authSession";
import { queryClient } from "../lib/queryClient";
import { resetGuidanceTours } from "../components/dashboard/guidance/guidanceStorage";
import {
  AUTH_ERROR_CODES,
  AUTH_MESSAGES,
  formatLockoutMessage,
} from "../../../shared/authValidation.js";
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

function getOrCreateOAuthTask(code, state, isConnectMode) {
  const key = `${isConnectMode ? "connect" : "login"}:${code}:${state || ""}`;
  if (inFlightOAuthRequests.has(key)) {
    return inFlightOAuthRequests.get(key);
  }
  const mode = isConnectMode ? "connect" : "login";
  const returnPath = isConnectMode ? safeConnectReturnPath() : null;
  sessionStorage.removeItem("covai.githubOAuthMode");
  sessionStorage.removeItem("covai.githubConnectReturn");

  const promise = (
    mode === "connect"
      ? connectGithubApi(code, state || "")
      : oAuthGithubApi(code, state || "")
  ).finally(() => {
    setTimeout(() => inFlightOAuthRequests.delete(key), 5000);
  });

  const task = { mode, returnPath, promise };
  inFlightOAuthRequests.set(key, task);
  return task;
}

function persistAuthenticatedSession(data) {
  resetGuidanceTours();
  const accessToken = data.accessToken || data.token;
  const userPayload = {
    id: data.userId || data.id || null,
    name: data.name || "",
    email: data.email || "",
    token: accessToken,
  };
  localStorage.setItem("token", accessToken);
  localStorage.setItem("user", JSON.stringify(userPayload));
  localStorage.setItem("userName", data.name || "");
  localStorage.setItem("userEmail", data.email || "");
}

export default function GithubCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const code = searchParams.get("code");
  const errorParam = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  const oauthState = searchParams.get("state");
  const storedMode = sessionStorage.getItem("covai.githubOAuthMode");
  const hasToken = Boolean(getAccessToken());
  const wantsConnectMode =
    oauthState === "connect" ||
    oauthState?.startsWith("connect.") ||
    storedMode === "connect";
  const isConnectMode = wantsConnectMode && hasToken;

  const [asyncErrorState, setAsyncErrorState] = useState(null);
  const [pendingLink, setPendingLink] = useState(null);
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [linkError, setLinkError] = useState(null);
  const [linkTokenExpired, setLinkTokenExpired] = useState(false);

  const initialErrorState = errorParam
    ? {
        mode: wantsConnectMode ? "connect" : "login",
        returnPath: wantsConnectMode ? safeConnectReturnPath() : "/login",
        message:
          errorParam === "access_denied"
            ? AUTH_MESSAGES.OAUTH_ACCESS_DENIED
            : errorDescription ||
              "GitHub authentication failed. Please try again.",
      }
    : null;

  const errorState = initialErrorState || asyncErrorState;

  useEffect(() => {
    let active = true;

    if (errorParam) {
      sessionStorage.removeItem("covai.githubOAuthMode");
      sessionStorage.removeItem("covai.githubConnectReturn");
      window.history.replaceState({}, document.title, "/auth/github/callback");
      return () => {
        active = false;
      };
    }

    if (!code) {
      navigate(wantsConnectMode ? "/projects" : "/login", { replace: true });
      return () => {
        active = false;
      };
    }

    // Clear code and state from the address bar to avoid reuse on manual refresh
    window.history.replaceState({}, document.title, "/auth/github/callback");

    const runCallback = async () => {
      let resolvedConnectMode = isConnectMode;
      if (wantsConnectMode && !hasToken) {
        const refreshedToken = await refreshAccessToken();
        if (!active) return;
        if (!refreshedToken) {
          sessionStorage.removeItem("covai.githubOAuthMode");
          sessionStorage.removeItem("covai.githubConnectReturn");
          setAsyncErrorState({
            mode: "login",
            returnPath: "/login",
            message:
              "Please sign in to your CovAI account before connecting GitHub.",
          });
          return;
        }
        resolvedConnectMode = true;
      }

      const task = getOrCreateOAuthTask(code, oauthState, resolvedConnectMode);
      const data = await task.promise;
      if (!active) return;

      if (task.mode === "connect") {
        queryClient.invalidateQueries();
        navigate(task.returnPath || "/projects", {
          replace: true,
          state: { openImport: true, githubConnected: true },
        });
        return;
      }

      if (data?.status === "LINK_REQUIRED") {
        setPendingLink(data);
        return;
      }

      persistAuthenticatedSession(data);
      const target = consumeAuthReturn();
      queryClient.clear();
      navigate(target, { replace: true });
      window.dispatchEvent(new Event("covai:auth-change"));
    };

    runCallback().catch((err) => {
      if (!active) return;
      setAsyncErrorState({
        mode: wantsConnectMode ? "connect" : "login",
        returnPath: wantsConnectMode ? safeConnectReturnPath() : "/login",
        message: err?.message || "GitHub authentication failed.",
      });
    });

    return () => {
      active = false;
    };
  }, [
    code,
    oauthState,
    errorParam,
    isConnectMode,
    wantsConnectMode,
    hasToken,
    navigate,
  ]);

  const handleConfirmLink = async (e) => {
    e.preventDefault();
    if (
      !pendingLink?.linkToken ||
      confirmBusy ||
      cancelBusy ||
      linkTokenExpired
    ) {
      return;
    }
    if (!password) {
      setLinkError({
        message: AUTH_MESSAGES.PASSWORD_REQUIRED,
        code: AUTH_ERROR_CODES.VALIDATION_ERROR,
      });
      return;
    }

    setLinkError(null);
    setConfirmBusy(true);
    try {
      const data = await confirmGithubLinkApi({
        linkToken: pendingLink.linkToken,
        password,
      });
      persistAuthenticatedSession(data);
      const target = consumeAuthReturn();
      queryClient.clear();
      navigate(target, { replace: true });
      window.dispatchEvent(new Event("covai:auth-change"));
    } catch (err) {
      setConfirmBusy(false);
      if (err?.code === AUTH_ERROR_CODES.INVALID_LINK_TOKEN) {
        setLinkTokenExpired(true);
      }
      const msg =
        err?.code === AUTH_ERROR_CODES.ACCOUNT_LOCKED && err?.retryAfterSeconds
          ? formatLockoutMessage(err.retryAfterSeconds)
          : err?.message || "Unable to verify password and link account.";
      setLinkError({
        message: msg,
        code: err?.code || null,
        retryAfterSeconds: err?.retryAfterSeconds || null,
      });
    }
  };

  const handleCancelLink = async () => {
    if (confirmBusy || cancelBusy) return;
    setCancelBusy(true);
    await cancelGithubLinkApi(pendingLink?.linkToken).catch(() => {});
    navigate("/login", { replace: true });
  };

  if (pendingLink) {
    const existingEmail = pendingLink.existingAccount?.email || "";
    const githubLogin = pendingLink.githubAccount?.login;
    const githubName = pendingLink.githubAccount?.name;
    const githubAvatar = pendingLink.githubAccount?.avatarUrl;
    const isLocked = linkError?.code === AUTH_ERROR_CODES.ACCOUNT_LOCKED;

    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--color-bg)] text-[var(--color-text)] font-sans">
        <div className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 flex flex-col gap-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/25 flex items-center justify-center text-[var(--color-primary)] shrink-0">
              <Link2 size={18} />
            </div>
            <div className="min-w-0">
              <h1
                id="github-link-heading"
                className="text-base font-semibold tracking-tight text-[var(--color-text)]"
              >
                Confirm GitHub Account Linking
              </h1>
              <p className="text-xs text-[var(--color-text-secondary)] mt-1 leading-relaxed">
                An existing CovAI account already uses{" "}
                <span className="font-mono text-[var(--color-text)]">
                  {existingEmail}
                </span>
                . Enter your local account password to verify ownership and link
                GitHub.
              </p>
            </div>
          </div>

          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {githubAvatar ? (
                <img
                  src={githubAvatar}
                  alt={githubLogin || "GitHub avatar"}
                  className="w-9 h-9 rounded-full border border-[var(--color-border)] shrink-0 object-cover"
                />
              ) : (
                <div className="w-9 h-9 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-center text-xs font-mono text-[var(--color-text-secondary)] shrink-0">
                  GH
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[var(--color-text)] truncate">
                  {githubName ||
                    (githubLogin ? `@${githubLogin}` : "GitHub Account")}
                </p>
                {githubLogin && (
                  <p className="text-[11px] font-mono text-[var(--color-text-muted)] truncate">
                    @{githubLogin}
                  </p>
                )}
              </div>
            </div>
            <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-md bg-sky-500/10 text-sky-400 border border-sky-500/20 shrink-0">
              GitHub OAuth
            </span>
          </div>

          {linkError && (
            <div
              role="alert"
              id="github-link-error"
              className="p-3 rounded-md bg-rose-500/10 border border-rose-500/20 flex items-start gap-2 text-xs text-rose-400"
            >
              {isLocked ? (
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <span>{linkError.message}</span>
            </div>
          )}

          <form
            onSubmit={handleConfirmLink}
            noValidate
            className="flex flex-col gap-4"
          >
            <div>
              <label
                htmlFor="github-link-password"
                className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5"
              >
                Existing CovAI password
              </label>
              <div className="relative flex items-center">
                <Lock className="w-4 h-4 text-[var(--color-text-muted)] absolute left-3 pointer-events-none" />
                <input
                  id="github-link-password"
                  type={showPass ? "text" : "password"}
                  value={password}
                  disabled={confirmBusy || linkTokenExpired}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (linkError) setLinkError(null);
                  }}
                  placeholder="Enter your local password"
                  className="w-full h-10 pl-9 pr-10 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus)]/40 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-2.5 p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
                  aria-label={showPass ? "Hide password" : "Show password"}
                >
                  {showPass ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[var(--color-border)]">
              <Button
                type="button"
                id="github-link-cancel-btn"
                variant="secondary"
                size="md"
                disabled={confirmBusy || cancelBusy}
                loading={cancelBusy}
                onClick={handleCancelLink}
              >
                {linkTokenExpired ? "Back to Login" : "Cancel"}
              </Button>
              {!linkTokenExpired && (
                <Button
                  type="submit"
                  id="github-link-confirm-btn"
                  variant="primary"
                  size="md"
                  loading={confirmBusy}
                  disabled={cancelBusy || !password}
                >
                  Confirm &amp; Link GitHub Account
                </Button>
              )}
            </div>
          </form>
        </div>
      </div>
    );
  }

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

  return (
    <div className="h-screen flex items-center justify-center flex-col gap-4 bg-[var(--color-bg)] text-[var(--color-text)] font-sans">
      <Loader2 size={32} className="animate-spin text-[var(--color-primary)]" />
      <span className="text-sm font-medium text-[var(--color-text-secondary)]">
        Authenticating with GitHub...
      </span>
    </div>
  );
}
