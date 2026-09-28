import { useState } from "react";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  User,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { loginApi, registerApi } from "../../services/auth.service";

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AuthForm({ mode, onToggleMode, setMode }) {
  const isLogin = mode === "login";

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [errors, setErrors] = useState({});
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | loading | success | error
  const [serverMessage, setServerMessage] = useState("");

  const update = (field) => (e) => {
    setFormData((d) => ({ ...d, [field]: e.target.value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: "" }));
    setServerMessage("");
  };

  function validate() {
    const errs = {};
    if (!isLogin && !formData.name.trim()) {
      errs.name = "Full name is required";
    }
    if (!formData.email.trim()) {
      errs.email = "Email address is required";
    } else if (!EMAIL_RE.test(formData.email)) {
      errs.email = "Please enter a valid email address";
    }
    if (!formData.password) {
      errs.password = "Password is required";
    } else if (formData.password.length < 8) {
      errs.password = "Password must be at least 8 characters";
    }
    if (!isLogin && formData.confirm !== formData.password) {
      errs.confirm = "Passwords do not match";
    }
    return errs;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setServerMessage("");

    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      setStatus("error");
      return;
    }

    setErrors({});
    setStatus("loading");

    try {
      if (isLogin) {
        const data = await loginApi({
          email: formData.email,
          password: formData.password,
        });
        localStorage.setItem("token", data.accessToken);
        localStorage.setItem("userName", data.name);
        localStorage.setItem("userEmail", data.email);
      } else {
        const data = await registerApi({
          name: formData.name,
          email: formData.email,
          password: formData.password,
        });
        localStorage.setItem("token", data.accessToken);
        localStorage.setItem("userName", data.userName);
        localStorage.setItem("userEmail", data.userEmail);
      }
      setStatus("success");
      setTimeout(() => {
        window.location.href = "/projects";
      }, 1000);
    } catch (err) {
      setStatus("error");
      if (err.type === "field" && err.errors) {
        setErrors(err.errors);
      } else {
        setServerMessage(
          err.message || "Authentication failed. Please verify credentials.",
        );
      }
    }
  }

  const handleGithubOAuth = () => {
    const clientId =
      import.meta.env.VITE_GITHUB_CLIENT_ID || "Ov23liQyAORXbj6NeqAB";
    const redirectUri = `${window.location.origin}/auth/github/callback`;
    window.location.href = `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=user:email repo&redirect_uri=${redirectUri}`;
  };

  return (
    <div className="w-full max-w-[380px] mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--color-text)] mb-1.5">
          {isLogin ? "Sign in to CovAI" : "Create developer account"}
        </h1>
        <p className="text-xs sm:text-sm text-[var(--color-text-secondary)] leading-relaxed">
          {isLogin
            ? "Enter your credentials to access your projects and test dashboards."
            : "Automate test generation and branch coverage in minutes."}
        </p>
      </div>

      {/* Success banner */}
      {status === "success" && (
        <div className="p-4 rounded-[var(--radius-lg)] bg-[var(--color-success)]/10 border border-[var(--color-success)]/30 text-center mb-6">
          <CheckCircle2 className="w-7 h-7 text-[var(--color-success)] mx-auto mb-2" />
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            {isLogin ? "Sign in successful" : "Account created successfully"}
          </h2>
          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
            Redirecting to projects...
          </p>
        </div>
      )}

      {status !== "success" && (
        <>
          {/* GitHub OAuth Button */}
          <button
            type="button"
            id="auth-github-btn"
            onClick={handleGithubOAuth}
            className="w-full h-10 px-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] text-sm font-medium transition-colors flex items-center justify-center gap-2.5 cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] mb-4"
          >
            <GithubIcon size={16} />
            <span>Continue with GitHub</span>
          </button>

          {/* Divider */}
          <div className="relative flex items-center justify-center my-5">
            <div className="border-t border-[var(--color-border)] w-full" />
            <span className="bg-[var(--color-bg)] px-3 text-[11px] font-normal text-[var(--color-text-muted)] absolute">
              or continue with email
            </span>
          </div>

          {/* Server Error Message */}
          {serverMessage && (
            <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 flex items-start gap-2 mb-4 text-xs text-[var(--color-danger)]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{serverMessage}</span>
            </div>
          )}

          {/* Form */}
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
                  className="block text-xs font-medium text-[var(--color-text)] mb-1.5"
                >
                  Full name{" "}
                  <span className="text-[var(--color-danger)]">*</span>
                </label>
                <div className="relative flex items-center">
                  <User className="w-4 h-4 text-[var(--color-text-muted)] absolute left-3.5 pointer-events-none" />
                  <input
                    id="auth-name"
                    type="text"
                    placeholder="Alex Developer"
                    value={formData.name}
                    onChange={update("name")}
                    className={`w-full h-10 pl-10 pr-3.5 rounded-[var(--radius-md)] border bg-[var(--color-surface)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-muted)] transition-colors focus:outline-none ${
                      errors.name
                        ? "border-[var(--color-danger)] focus:border-[var(--color-danger)] focus:ring-1 focus:ring-[var(--color-danger)]"
                        : "border-[var(--color-border)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
                    }`}
                  />
                </div>
                {errors.name && (
                  <p className="mt-1 text-xs text-[var(--color-danger)] flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    <span>{errors.name}</span>
                  </p>
                )}
              </div>
            )}

            <div>
              <label
                htmlFor="auth-email"
                className="block text-xs font-medium text-[var(--color-text)] mb-1.5"
              >
                Email address{" "}
                <span className="text-[var(--color-danger)]">*</span>
              </label>
              <div className="relative flex items-center">
                <Mail className="w-4 h-4 text-[var(--color-text-muted)] absolute left-3.5 pointer-events-none" />
                <input
                  id="auth-email"
                  type="email"
                  placeholder="alex@company.com"
                  value={formData.email}
                  onChange={update("email")}
                  className={`w-full h-10 pl-10 pr-3.5 rounded-[var(--radius-md)] border bg-[var(--color-surface)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-muted)] transition-colors focus:outline-none ${
                    errors.email
                      ? "border-[var(--color-danger)] focus:border-[var(--color-danger)] focus:ring-1 focus:ring-[var(--color-danger)]"
                      : "border-[var(--color-border)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
                  }`}
                />
              </div>
              {errors.email && (
                <p className="mt-1 text-xs text-[var(--color-danger)] flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  <span>{errors.email}</span>
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="auth-password"
                  className="block text-xs font-medium text-[var(--color-text)]"
                >
                  Password <span className="text-[var(--color-danger)]">*</span>
                </label>
                {isLogin && (
                  <button
                    type="button"
                    onClick={() => setMode("forgot_password")}
                    className="text-xs text-[var(--color-primary)] hover:underline cursor-pointer"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative flex items-center">
                <Lock className="w-4 h-4 text-[var(--color-text-muted)] absolute left-3.5 pointer-events-none" />
                <input
                  id="auth-password"
                  type={showPass ? "text" : "password"}
                  placeholder={isLogin ? "••••••••" : "Minimum 8 characters"}
                  value={formData.password}
                  onChange={update("password")}
                  className={`w-full h-10 pl-10 pr-10 rounded-[var(--radius-md)] border bg-[var(--color-surface)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-muted)] transition-colors focus:outline-none ${
                    errors.password
                      ? "border-[var(--color-danger)] focus:border-[var(--color-danger)] focus:ring-1 focus:ring-[var(--color-danger)]"
                      : "border-[var(--color-border)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-3 p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
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
                <p className="mt-1 text-xs text-[var(--color-danger)] flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  <span>{errors.password}</span>
                </p>
              )}
            </div>

            {!isLogin && (
              <div>
                <label
                  htmlFor="auth-confirm"
                  className="block text-xs font-medium text-[var(--color-text)] mb-1.5"
                >
                  Confirm password{" "}
                  <span className="text-[var(--color-danger)]">*</span>
                </label>
                <div className="relative flex items-center">
                  <Lock className="w-4 h-4 text-[var(--color-text-muted)] absolute left-3.5 pointer-events-none" />
                  <input
                    id="auth-confirm"
                    type={showConfirm ? "text" : "password"}
                    placeholder="Re-enter password"
                    value={formData.confirm}
                    onChange={update("confirm")}
                    className={`w-full h-10 pl-10 pr-10 rounded-[var(--radius-md)] border bg-[var(--color-surface)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-muted)] transition-colors focus:outline-none ${
                      errors.confirm
                        ? "border-[var(--color-danger)] focus:border-[var(--color-danger)] focus:ring-1 focus:ring-[var(--color-danger)]"
                        : "border-[var(--color-border)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-3 p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
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
                  <p className="mt-1 text-xs text-[var(--color-danger)] flex items-center gap-1">
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
              className="w-full h-10 rounded-[var(--radius-md)] bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] active:bg-[var(--color-primary-active)] text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-sm focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-2"
            >
              {status === "loading" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>
                    {isLogin ? "Signing in..." : "Creating account..."}
                  </span>
                </>
              ) : (
                <>
                  <span>{isLogin ? "Sign in" : "Create account"}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Mode Switcher */}
          <div className="mt-5 text-center text-xs text-[var(--color-text-secondary)]">
            {isLogin ? (
              <>
                Don&apos;t have an account?{" "}
                <button
                  type="button"
                  id="auth-toggle-to-register"
                  onClick={onToggleMode}
                  className="font-semibold text-[var(--color-primary)] hover:underline cursor-pointer"
                >
                  Create account
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  id="auth-toggle-to-login"
                  onClick={onToggleMode}
                  className="font-semibold text-[var(--color-primary)] hover:underline cursor-pointer"
                >
                  Sign in
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
