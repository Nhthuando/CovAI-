import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  User,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import {
  loginApi,
  registerApi,
  fetchGithubAuthorizeUrlApi,
} from "../../services/auth.service";
import { consumeAuthReturn } from "../../lib/authReturn";
import { queryClient } from "../../lib/queryClient";
import {
  EMAIL_REGEX,
  AUTH_MESSAGES,
  AUTH_ERROR_CODES,
  formatLockoutMessage,
} from "../../../../shared/authValidation.js";

function GithubIcon({ size = 16, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

export default function AuthForm({
  mode,
  onToggleMode,
  setMode,
  onForgotPassword,
}) {
  const isLogin = mode === "login";
  const navigate = useNavigate();
  const submittingRef = useRef(false);

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [errors, setErrors] = useState({});
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [status, setStatus] = useState("idle");
  const [githubLoading, setGithubLoading] = useState(false);
  const [serverError, setServerError] = useState(null);

  const update = (field) => (e) => {
    setFormData((d) => ({ ...d, [field]: e.target.value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: "" }));
    if (serverError) setServerError(null);
  };

  function validate() {
    const errs = {};
    const trimmedEmail = formData.email.trim();
    if (!isLogin && !formData.name.trim()) {
      errs.name = AUTH_MESSAGES.FULL_NAME_REQUIRED;
    }
    if (!trimmedEmail) {
      errs.email = AUTH_MESSAGES.EMAIL_REQUIRED;
    } else if (!EMAIL_REGEX.test(trimmedEmail)) {
      errs.email = AUTH_MESSAGES.EMAIL_INVALID;
    }
    if (!formData.password) {
      errs.password = AUTH_MESSAGES.PASSWORD_REQUIRED;
    } else if (!isLogin && formData.password.length < 8) {
      errs.password = AUTH_MESSAGES.PASSWORD_MIN_LENGTH;
    }
    if (!isLogin && formData.confirm !== formData.password) {
      errs.confirm = AUTH_MESSAGES.PASSWORDS_DO_NOT_MATCH;
    }
    return errs;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submittingRef.current || status === "loading") return;

    setServerError(null);

    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      setStatus("error");
      return;
    }

    submittingRef.current = true;
    setErrors({});
    setStatus("loading");

    try {
      await queryClient.cancelQueries();
      queryClient.clear();
      const normalizedEmail = formData.email.trim().toLowerCase();

      if (isLogin) {
        const data = await loginApi({
          email: normalizedEmail,
          password: formData.password,
        });
        const userPayload = {
          id: data.userId || null,
          name: data.name || "",
          email: data.email || normalizedEmail,
          authProvider: data.authProvider || "email",
          token: data.accessToken,
        };
        localStorage.setItem("token", data.accessToken);
        localStorage.setItem("user", JSON.stringify(userPayload));
        localStorage.setItem("userName", data.name || "");
        localStorage.setItem("userEmail", data.email || normalizedEmail);
      } else {
        const data = await registerApi({
          name: formData.name.trim(),
          email: normalizedEmail,
          password: formData.password,
        });
        const userPayload = {
          id: data.userId || null,
          name: data.userName || "",
          email: data.userEmail || normalizedEmail,
          authProvider: data.authProvider || "email",
          token: data.accessToken,
        };
        localStorage.setItem("token", data.accessToken);
        localStorage.setItem("user", JSON.stringify(userPayload));
        localStorage.setItem("userName", data.userName || "");
        localStorage.setItem("userEmail", data.userEmail || normalizedEmail);
      }

      const targetPath = consumeAuthReturn();
      setStatus("success");
      navigate(targetPath, { replace: true });
      window.dispatchEvent(new Event("covai:auth-change"));
    } catch (err) {
      submittingRef.current = false;
      setStatus("error");
      if (err?.type === "field" && err.errors) {
        setErrors(err.errors);
      } else {
        const msg =
          err?.code === AUTH_ERROR_CODES.ACCOUNT_LOCKED && err?.retryAfterSeconds
            ? formatLockoutMessage(err.retryAfterSeconds)
            : err?.message || "Authentication failed. Please verify credentials.";
        setServerError({
          message: msg,
          code: err?.code || null,
          status: err?.status || null,
          lockedUntil: err?.lockedUntil || null,
          retryAfterSeconds: err?.retryAfterSeconds || null,
        });
      }
    }
  }

  const handleGithubOAuth = async () => {
    if (githubLoading || status === "loading") return;
    setServerError(null);
    setGithubLoading(true);
    try {
      const oauthUrl = await fetchGithubAuthorizeUrlApi("login");
      sessionStorage.setItem("covai.githubOAuthMode", "login");
      window.location.assign(oauthUrl);
    } catch (err) {
      setGithubLoading(false);
      setServerError({
        message: err?.message || "GitHub OAuth is not configured.",
        code: err?.code || null,
      });
    }
  };

  const isLockedError = serverError?.code === AUTH_ERROR_CODES.ACCOUNT_LOCKED;
  const isOauthOnlyError =
    serverError?.code === AUTH_ERROR_CODES.OAUTH_ONLY_ACCOUNT;

  return (
    <div className="w-full">
      <div className="mb-5">
        <h1 className="lp-display text-2xl font-bold tracking-tight text-[var(--lp-ink)] mb-1">
          {isLogin ? "Sign in" : "Create account"}
        </h1>
        <p className="text-xs text-[var(--lp-ink-secondary)]">
          {isLogin
            ? "Access your repositories and coverage runs."
            : "Start analyzing branches in minutes."}
        </p>
      </div>

      {status === "success" && (
        <div className="p-5 rounded-xl bg-[var(--lp-signal-bg)] border border-[var(--lp-signal-border)] text-center mb-6">
          <CheckCircle2 className="w-7 h-7 text-[var(--lp-signal)] mx-auto mb-2" />
          <h2 className="text-sm font-semibold text-[var(--lp-ink)]">
            {isLogin ? "Sign in successful" : "Account created"}
          </h2>
          <p className="text-xs text-[var(--lp-ink-secondary)] mt-0.5 lp-mono">
            Opening workspace...
          </p>
        </div>
      )}

      {status !== "success" && (
        <>
          <button
            type="button"
            id="auth-github-btn"
            disabled={githubLoading || status === "loading"}
            onClick={handleGithubOAuth}
            className="w-full h-10 px-4 rounded-lg lp-btn-secondary text-xs sm:text-sm font-medium flex items-center justify-center gap-2.5 cursor-pointer mb-4 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {githubLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <GithubIcon size={16} />
            )}
            <span>
              {githubLoading ? "Redirecting to GitHub..." : "Continue with GitHub"}
            </span>
          </button>

          <div className="relative flex items-center justify-center my-5">
            <div className="border-t border-[var(--lp-line)] w-full" />
            <span className="bg-[var(--lp-surface)] px-3 text-[11px] lp-mono text-[var(--lp-ink-muted)] absolute">
              or with email
            </span>
          </div>

          {serverError && (
            <div
              role="alert"
              id="auth-server-error"
              className={`p-3 rounded-lg border flex flex-col gap-2 mb-4 text-xs ${
                isOauthOnlyError
                  ? "bg-[var(--lp-signal-bg)] border-[var(--lp-signal-border)] text-[var(--lp-ink)]"
                  : "bg-[var(--lp-fault-bg)] border-[var(--lp-fault-border)] text-[var(--lp-fault)]"
              }`}
            >
              <div className="flex items-start gap-2">
                {isLockedError ? (
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <div className="space-y-1">
                  <span>{serverError.message}</span>
                  {isLockedError && serverError.retryAfterSeconds && (
                    <p className="lp-mono text-[11px] opacity-90">
                      Wait{" "}
                      {Math.ceil(serverError.retryAfterSeconds / 60)} min (
                      {serverError.retryAfterSeconds}s) before retrying.
                    </p>
                  )}
                </div>
              </div>

              {isOauthOnlyError && (
                <div className="flex flex-wrap items-center gap-2 pl-6 pt-1">
                  <button
                    type="button"
                    id="auth-oauth-guidance-github"
                    onClick={handleGithubOAuth}
                    className="px-2.5 py-1 rounded-md border border-[var(--lp-line-strong)] bg-[var(--lp-surface)] text-[var(--lp-ink)] hover:border-[var(--lp-signal)] text-[11px] font-medium cursor-pointer"
                  >
                    Sign in with GitHub
                  </button>
                  <button
                    type="button"
                    id="auth-oauth-guidance-forgot"
                    onClick={() =>
                      onForgotPassword
                        ? onForgotPassword(formData.email.trim())
                        : setMode("forgot_password")
                    }
                    className="px-2.5 py-1 rounded-md text-[var(--lp-signal)] hover:underline text-[11px] font-medium cursor-pointer"
                  >
                    Set a local password
                  </button>
                </div>
              )}
            </div>
          )}

          <form
            id={`auth-${mode}-form`}
            onSubmit={handleSubmit}
            noValidate
            className="space-y-4"
          >
            {!isLogin && (
              <div>
                <label
                  htmlFor="auth-name"
                  className="block text-xs font-medium text-[var(--lp-ink-secondary)] mb-1.5"
                >
                  Full name <span className="text-[var(--lp-fault)]">*</span>
                </label>
                <div className="relative flex items-center">
                  <User className="w-4 h-4 text-[var(--lp-ink-muted)] absolute left-3.5 pointer-events-none" />
                  <input
                    id="auth-name"
                    type="text"
                    placeholder="Alex Developer"
                    value={formData.name}
                    onChange={update("name")}
                    className={`w-full h-10 pl-10 pr-3.5 rounded-lg border bg-[var(--lp-inset)] text-[var(--lp-ink)] text-sm placeholder:text-[var(--lp-ink-muted)] transition-colors focus:outline-none ${
                      errors.name
                        ? "border-[var(--lp-fault)] focus:border-[var(--lp-fault)]"
                        : "border-[var(--lp-line-strong)] focus:border-[var(--lp-signal)]"
                    }`}
                  />
                </div>
                {errors.name && (
                  <p className="mt-1.5 text-xs text-[var(--lp-fault)] flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    <span>{errors.name}</span>
                  </p>
                )}
              </div>
            )}

            <div>
              <label
                htmlFor="auth-email"
                className="block text-xs font-medium text-[var(--lp-ink-secondary)] mb-1.5"
              >
                Email address <span className="text-[var(--lp-fault)]">*</span>
              </label>
              <div className="relative flex items-center">
                <Mail className="w-4 h-4 text-[var(--lp-ink-muted)] absolute left-3.5 pointer-events-none" />
                <input
                  id="auth-email"
                  type="email"
                  placeholder="alex@company.com"
                  value={formData.email}
                  onChange={update("email")}
                  className={`w-full h-10 pl-10 pr-3.5 rounded-lg border bg-[var(--lp-inset)] text-[var(--lp-ink)] text-sm placeholder:text-[var(--lp-ink-muted)] transition-colors focus:outline-none ${
                    errors.email
                      ? "border-[var(--lp-fault)] focus:border-[var(--lp-fault)]"
                      : "border-[var(--lp-line-strong)] focus:border-[var(--lp-signal)]"
                  }`}
                />
              </div>
              {errors.email && (
                <p className="mt-1.5 text-xs text-[var(--lp-fault)] flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  <span>{errors.email}</span>
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="auth-password"
                  className="block text-xs font-medium text-[var(--lp-ink-secondary)]"
                >
                  Password <span className="text-[var(--lp-fault)]">*</span>
                </label>
                {isLogin && (
                  <button
                    type="button"
                    onClick={() =>
                      onForgotPassword
                        ? onForgotPassword(formData.email.trim())
                        : setMode("forgot_password")
                    }
                    className="text-xs text-[var(--lp-signal)] hover:underline cursor-pointer"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative flex items-center">
                <Lock className="w-4 h-4 text-[var(--lp-ink-muted)] absolute left-3.5 pointer-events-none" />
                <input
                  id="auth-password"
                  type={showPass ? "text" : "password"}
                  placeholder={isLogin ? "••••••••" : "Minimum 8 characters"}
                  value={formData.password}
                  onChange={update("password")}
                  className={`w-full h-10 pl-10 pr-10 rounded-lg border bg-[var(--lp-inset)] text-[var(--lp-ink)] text-sm placeholder:text-[var(--lp-ink-muted)] transition-colors focus:outline-none ${
                    errors.password
                      ? "border-[var(--lp-fault)] focus:border-[var(--lp-fault)]"
                      : "border-[var(--lp-line-strong)] focus:border-[var(--lp-signal)]"
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-3 p-1 text-[var(--lp-ink-muted)] hover:text-[var(--lp-ink)] cursor-pointer"
                  aria-label={showPass ? "Hide password" : "Show password"}
                >
                  {showPass ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="mt-1.5 text-xs text-[var(--lp-fault)] flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  <span>{errors.password}</span>
                </p>
              )}
            </div>

            {!isLogin && (
              <div>
                <label
                  htmlFor="auth-confirm"
                  className="block text-xs font-medium text-[var(--lp-ink-secondary)] mb-1.5"
                >
                  Confirm password{" "}
                  <span className="text-[var(--lp-fault)]">*</span>
                </label>
                <div className="relative flex items-center">
                  <Lock className="w-4 h-4 text-[var(--lp-ink-muted)] absolute left-3.5 pointer-events-none" />
                  <input
                    id="auth-confirm"
                    type={showConfirm ? "text" : "password"}
                    placeholder="Re-enter password"
                    value={formData.confirm}
                    onChange={update("confirm")}
                    className={`w-full h-10 pl-10 pr-10 rounded-lg border bg-[var(--lp-inset)] text-[var(--lp-ink)] text-sm placeholder:text-[var(--lp-ink-muted)] transition-colors focus:outline-none ${
                      errors.confirm
                        ? "border-[var(--lp-fault)] focus:border-[var(--lp-fault)]"
                        : "border-[var(--lp-line-strong)] focus:border-[var(--lp-signal)]"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-3 p-1 text-[var(--lp-ink-muted)] hover:text-[var(--lp-ink)] cursor-pointer"
                    aria-label={showConfirm ? "Hide password" : "Show password"}
                  >
                    {showConfirm ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                {errors.confirm && (
                  <p className="mt-1.5 text-xs text-[var(--lp-fault)] flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    <span>{errors.confirm}</span>
                  </p>
                )}
              </div>
            )}

            <button
              type="submit"
              id="auth-submit-btn"
              disabled={status === "loading"}
              className="w-full h-10 rounded-lg lp-btn-primary text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed mt-2"
            >
              {status === "loading" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>
                    {isLogin ? "Signing in..." : "Creating account..."}
                  </span>
                </>
              ) : (
                <span>{isLogin ? "Sign in" : "Create account"}</span>
              )}
            </button>
          </form>

          <div className="mt-5 text-center text-xs text-[var(--lp-ink-secondary)]">
            {isLogin ? (
              <>
                New to CovAI?{" "}
                <Link
                  to="/register"
                  id="auth-toggle-to-register"
                  onClick={onToggleMode}
                  className="font-semibold text-[var(--lp-ink)] hover:text-[var(--lp-signal)] transition-colors cursor-pointer"
                >
                  Create account
                </Link>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <Link
                  to="/login"
                  id="auth-toggle-to-login"
                  onClick={onToggleMode}
                  className="font-semibold text-[var(--lp-ink)] hover:text-[var(--lp-signal)] transition-colors cursor-pointer"
                >
                  Sign in
                </Link>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
