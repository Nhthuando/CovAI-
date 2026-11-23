import { useState, Suspense, lazy } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import CovaiLogo from "../common/CovaiLogo";
import ThemeSelector from "../common/ThemeSelector";
import AuthForm from "./AuthForm";
import ForgotPasswordForm from "./ForgotPasswordForm";
import ResetPasswordForm from "./ResetPasswordForm";

const AuthVisualCanvas = lazy(() => import("./AuthVisualCanvas"));

const MODE_COPY = {
  login: {
    caption: "Workspace session",
    headline: "Resume your coverage graph.",
    status: "Docker runners & AST sync online",
  },
  register: {
    caption: "New repository",
    headline: "Map every branch in seconds.",
    status: "Unit CFG · API Matrix · Playwright E2E",
  },
  forgot_password: {
    caption: "Account recovery",
    headline: "Restore access to your workspace.",
    status: "Encrypted token dispatch",
  },
  reset_password: {
    caption: "Credentials update",
    headline: "Set a new workspace password.",
    status: "Session security check",
  },
};

export default function AuthLayout({
  initialMode = "login",
  children,
  invitationNotice,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [subModeState, setSubModeState] = useState(() =>
    initialMode === "reset_password" || initialMode === "forgot_password"
      ? { pathname: location.pathname, mode: initialMode }
      : { pathname: location.pathname, mode: null }
  );
  const [recoveryEmail, setRecoveryEmail] = useState("");

  const subMode =
    subModeState.pathname === location.pathname ||
    initialMode === "reset_password" ||
    initialMode === "forgot_password"
      ? subModeState.mode
      : null;

  const routeMode =
    location.pathname === "/register"
      ? "register"
      : location.pathname === "/login"
        ? "login"
        : initialMode;

  const mode = subMode || routeMode;
  const copy = MODE_COPY[mode] || MODE_COPY.login;

  const handleSetMode = (next) => {
    if (next === "login" || next === "register") {
      setSubModeState({ pathname: location.pathname, mode: null });
      setRecoveryEmail("");
      navigate(next === "login" ? "/login" : "/register");
    } else {
      setSubModeState({ pathname: location.pathname, mode: next });
    }
  };

  const handleForgotPassword = (prefillEmail = "") => {
    setRecoveryEmail(typeof prefillEmail === "string" ? prefillEmail : "");
    setSubModeState({ pathname: location.pathname, mode: "forgot_password" });
  };

  const toggleMode = (e) => {
    if (e?.preventDefault) e.preventDefault();
    const nextMode = mode === "login" ? "register" : "login";
    setSubModeState({ pathname: location.pathname, mode: null });
    navigate(nextMode === "login" ? "/login" : "/register");
  };

  return (
    <div className="lp min-h-screen grid grid-cols-1 lg:grid-cols-12 bg-[var(--lp-bg)] text-[var(--lp-ink)] relative overflow-hidden">
      {/* Architectural Drafting Grid */}
      <div className="absolute inset-0 lp-draft-grid lp-radial-fade pointer-events-none" />

      {/* ══════════════════════════════════════════════════════
          LEFT PANEL — Full-Height 3D Visual Stage (Minimal Copy)
          ══════════════════════════════════════════════════════ */}
      <div className="hidden lg:flex lg:col-span-6 xl:col-span-7 relative z-10 flex-col justify-between p-10 xl:p-14 border-r border-[var(--lp-line)] overflow-hidden">
        {/* Ambient radial highlight behind 3D sculpture */}
        <div
          className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[560px] h-[560px] rounded-full blur-[140px] opacity-20"
          style={{
            background:
              "radial-gradient(circle, var(--lp-signal) 0%, transparent 70%)",
          }}
        />

        {/* Top Brand Link */}
        <div className="relative z-20 flex items-center justify-between">
          <Link
            to="/"
            id="auth-logo"
            className="inline-flex items-center gap-2.5 focus-visible:outline-2 focus-visible:outline-[var(--lp-signal)] rounded-md"
          >
            <CovaiLogo size={28} />
            <span className="lp-display font-bold text-lg tracking-tight text-[var(--lp-ink)]">
              CovAI
            </span>
          </Link>

          <span className="inline-flex items-center gap-2 text-xs lp-mono text-[var(--lp-ink-secondary)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--lp-signal)]" />
            <span>{copy.caption}</span>
          </span>
        </div>

        {/* Center Full-Scale Interactive 3D Canvas */}
        <div className="relative z-10 flex-1 flex items-center justify-center my-4">
          <Suspense
            fallback={
              <div className="w-full h-[460px] flex items-center justify-center text-xs lp-mono text-[var(--lp-ink-muted)]">
                Loading 3D scene...
              </div>
            }
          >
            <AuthVisualCanvas mode={mode} />
          </Suspense>
        </div>

        {/* Bottom Minimal Headline & Telemetry Line */}
        <div className="relative z-20 flex items-end justify-between gap-6 pt-5 border-t border-[var(--lp-line)]">
          <h2 className="lp-display text-2xl xl:text-3xl font-bold tracking-tight text-[var(--lp-ink)]">
            {copy.headline}
          </h2>
          <span className="text-xs lp-mono text-[var(--lp-ink-muted)] shrink-0">
            {copy.status}
          </span>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          RIGHT PANEL — Airy Machined Form Container
          ══════════════════════════════════════════════════════ */}
      <div className="lg:col-span-6 xl:col-span-5 relative z-10 flex flex-col justify-between p-6 sm:p-10 xl:p-14">
        {/* Top Bar */}
        <div className="flex items-center justify-between w-full">
          <Link
            to="/"
            id="auth-back-home"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg lp-btn-secondary text-xs font-medium"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to home</span>
          </Link>

          <div className="flex items-center gap-2.5">
            <Link to="/" className="inline-flex lg:hidden items-center gap-2">
              <CovaiLogo size={24} />
              <span className="lp-display font-bold text-sm text-[var(--lp-ink)]">
                CovAI
              </span>
            </Link>
            <ThemeSelector compact className="!rounded-lg" />
          </div>
        </div>

        {/* Center Card */}
        <div className="my-auto py-8 w-full max-w-[390px] mx-auto">
          {invitationNotice && (
            <p
              role="status"
              className="mb-5 p-3.5 text-xs rounded-xl border border-[var(--lp-signal-border)] bg-[var(--lp-signal-bg)] text-[var(--lp-ink)] lp-mono"
            >
              {invitationNotice}
            </p>
          )}

          <div className="rounded-2xl lp-machined p-6 sm:p-8">
            {!children && (mode === "login" || mode === "register") && (
              <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[var(--lp-pill-bg)] border border-[var(--lp-line)] mb-6 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => handleSetMode("login")}
                  className={`py-2 rounded-md transition-colors cursor-pointer ${
                    mode === "login"
                      ? "bg-[var(--lp-pill-active)] text-[var(--lp-ink)] border border-[var(--lp-line-strong)] shadow-xs"
                      : "text-[var(--lp-ink-secondary)] hover:text-[var(--lp-ink)] border border-transparent"
                  }`}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => handleSetMode("register")}
                  className={`py-2 rounded-md transition-colors cursor-pointer ${
                    mode === "register"
                      ? "bg-[var(--lp-pill-active)] text-[var(--lp-ink)] border border-[var(--lp-line-strong)] shadow-xs"
                      : "text-[var(--lp-ink-secondary)] hover:text-[var(--lp-ink)] border border-transparent"
                  }`}
                >
                  Create account
                </button>
              </div>
            )}

            {children ||
              (mode === "forgot_password" ? (
                <ForgotPasswordForm
                  setMode={handleSetMode}
                  initialEmail={recoveryEmail}
                />
              ) : mode === "reset_password" ? (
                <ResetPasswordForm />
              ) : (
                <AuthForm
                  key={mode}
                  mode={mode}
                  onToggleMode={toggleMode}
                  setMode={handleSetMode}
                  onForgotPassword={handleForgotPassword}
                />
              ))}
          </div>
        </div>

        {/* Minimal Footer */}
        <div className="pt-5 border-t border-[var(--lp-line)] flex items-center justify-between text-xs text-[var(--lp-ink-muted)]">
          <span>© {new Date().getFullYear()} CovAI</span>
          <div className="flex items-center gap-4">
            <Link to="/privacy" className="hover:text-[var(--lp-ink)] transition-colors">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-[var(--lp-ink)] transition-colors">
              Terms
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
