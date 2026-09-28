import { useState } from "react";
import {
  Lock,
  Eye,
  EyeOff,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { resetPasswordApi } from "../../services/auth.service";
import Button from "../common/Button";

export default function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | loading | success | error
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
    <div className="w-full max-w-[380px] mx-auto">
      {status === "success" ? (
        <div className="p-6 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] text-center">
          <CheckCircle2 className="w-10 h-10 text-[var(--color-success)] mx-auto mb-3" />
          <h2 className="text-lg font-bold text-[var(--color-text)] mb-2">
            Password Updated
          </h2>
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed mb-6">
            Your credentials have been securely updated. You may now sign in
            with your new password.
          </p>
          <Button
            type="button"
            variant="primary"
            size="md"
            className="w-full"
            onClick={() => navigate("/login")}
          >
            Proceed to Sign In
          </Button>
        </div>
      ) : (
        <div>
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--color-text)] mb-1.5">
              Choose a new password
            </h1>
            <p className="text-xs sm:text-sm text-[var(--color-text-secondary)] leading-relaxed">
              Enter your new password below. Make sure it contains at least 8
              characters.
            </p>
          </div>

          {/* Error Message */}
          {errorMsg && (
            <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 flex items-start gap-2 mb-4 text-xs text-[var(--color-danger)]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div>
              <label
                htmlFor="new-password"
                className="block text-xs font-medium text-[var(--color-text)] mb-1.5"
              >
                New password{" "}
                <span className="text-[var(--color-danger)]">*</span>
              </label>
              <div className="relative flex items-center">
                <Lock className="w-4 h-4 text-[var(--color-text-muted)] absolute left-3.5 pointer-events-none" />
                <input
                  id="new-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setErrorMsg("");
                  }}
                  placeholder="Minimum 8 characters"
                  className="w-full h-10 pl-10 pr-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] text-sm transition-colors focus:outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
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
                className="block text-xs font-medium text-[var(--color-text)] mb-1.5"
              >
                Confirm new password{" "}
                <span className="text-[var(--color-danger)]">*</span>
              </label>
              <div className="relative flex items-center">
                <Lock className="w-4 h-4 text-[var(--color-text-muted)] absolute left-3.5 pointer-events-none" />
                <input
                  id="confirm-new-password"
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setErrorMsg("");
                  }}
                  placeholder="Re-enter new password"
                  className="w-full h-10 pl-10 pr-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] text-sm transition-colors focus:outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
                />
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={status === "loading"}
              className="w-full font-semibold"
            >
              Update Password
            </Button>
          </form>

          {/* Back to login */}
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Sign In</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
