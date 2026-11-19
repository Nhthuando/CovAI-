import { useState } from "react";
import {
  Lock,
  Eye,
  EyeOff,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { resetPasswordApi } from "../../services/auth.service";

export default function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!token) {
      setErrorMsg("Invalid or missing reset token. Please request a new link.");
      setStatus("error");
      return;
    }
    if (!password || password.length < 8) {
      setErrorMsg("Password must be at least 8 characters");
      setStatus("error");
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg("Passwords do not match");
      setStatus("error");
      return;
    }
    setErrorMsg("");
    setStatus("loading");

    try {
      await resetPasswordApi(token, password);
      setStatus("success");
    } catch (error) {
      setErrorMsg(error.message || "Failed to update password.");
      setStatus("error");
    }
  };

  return (
    <div className="w-full">
      {status === "success" ? (
        <div className="p-6 rounded-xl bg-[var(--lp-inset)] border border-[var(--lp-line)] text-center">
          <CheckCircle2 className="w-9 h-9 text-[var(--lp-signal)] mx-auto mb-3" />
          <h2 className="lp-display text-lg font-bold text-[var(--lp-ink)] mb-2">
            Password updated
          </h2>
          <p className="text-xs text-[var(--lp-ink-secondary)] leading-relaxed mb-6">
            Your credentials have been updated. You can now sign in with your
            new password.
          </p>
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="w-full h-10 rounded-lg lp-btn-primary text-xs sm:text-sm cursor-pointer"
          >
            Proceed to sign in
          </button>
        </div>
      ) : (
        <div>
          <div className="mb-6">
            <h1 className="lp-display text-2xl font-bold tracking-tight text-[var(--lp-ink)] mb-1.5">
              Choose a new password
            </h1>
            <p className="text-xs sm:text-sm text-[var(--lp-ink-secondary)] leading-relaxed">
              Enter your new password below (minimum 8 characters).
            </p>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-lg bg-[var(--lp-fault-bg)] border border-[var(--lp-fault-border)] flex items-start gap-2 mb-4 text-xs text-[var(--lp-fault)]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div>
              <label
                htmlFor="new-password"
                className="block text-xs font-medium text-[var(--lp-ink-secondary)] mb-1.5"
              >
                New password <span className="text-[var(--lp-fault)]">*</span>
              </label>
              <div className="relative flex items-center">
                <Lock className="w-4 h-4 text-[var(--lp-ink-muted)] absolute left-3.5 pointer-events-none" />
                <input
                  id="new-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setErrorMsg("");
                  }}
                  placeholder="Minimum 8 characters"
                  className="w-full h-10 pl-10 pr-10 rounded-lg border border-[var(--lp-line-strong)] bg-[var(--lp-inset)] text-[var(--lp-ink)] placeholder:text-[var(--lp-ink-muted)] text-sm transition-colors focus:outline-none focus:border-[var(--lp-signal)]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 p-1 text-[var(--lp-ink-muted)] hover:text-[var(--lp-ink)] cursor-pointer"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="confirm-new-password"
                className="block text-xs font-medium text-[var(--lp-ink-secondary)] mb-1.5"
              >
                Confirm new password <span className="text-[var(--lp-fault)]">*</span>
              </label>
              <div className="relative flex items-center">
                <Lock className="w-4 h-4 text-[var(--lp-ink-muted)] absolute left-3.5 pointer-events-none" />
                <input
                  id="confirm-new-password"
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setErrorMsg("");
                  }}
                  placeholder="Re-enter new password"
                  className="w-full h-10 pl-10 pr-10 rounded-lg border border-[var(--lp-line-strong)] bg-[var(--lp-inset)] text-[var(--lp-ink)] placeholder:text-[var(--lp-ink-muted)] text-sm transition-colors focus:outline-none focus:border-[var(--lp-signal)]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={status === "loading"}
              className="w-full h-10 rounded-lg lp-btn-primary text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {status === "loading" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Updating password...</span>
                </>
              ) : (
                <span>Update password</span>
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="inline-flex items-center gap-1.5 text-xs text-[var(--lp-ink-secondary)] hover:text-[var(--lp-ink)] transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to sign in</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
