import { useState } from "react";
import {
  Mail,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { forgotPasswordApi } from "../../services/auth.service";
import Button from "../common/Button";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordForm({ setMode }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | success | error
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim()) {
      setErrorMsg("Email address is required");
      setStatus("error");
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setErrorMsg("Please enter a valid email address");
      setStatus("error");
      return;
    }

    setErrorMsg("");
    setStatus("loading");

    try {
      await forgotPasswordApi(email.trim().toLowerCase());
      setStatus("success");
    } catch (error) {
      setErrorMsg(error.message || "Failed to send reset link.");
      setStatus("error");
    }
  };

  return (
    <div className="w-full max-w-[380px] mx-auto">
      {status === "success" ? (
        <div className="p-6 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] text-center">
          <CheckCircle2 className="w-10 h-10 text-[var(--color-success)] mx-auto mb-3" />
          <h2 className="text-lg font-bold text-[var(--color-text)] mb-2">
            Reset Link Dispatched
          </h2>
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed mb-6">
            If an account exists for{" "}
            <span className="font-semibold text-[var(--color-text)]">
              {email}
            </span>
            , you will receive password reset instructions shortly.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="md"
            className="w-full"
            onClick={() => setMode("login")}
            icon={ArrowLeft}
          >
            Return to Sign In
          </Button>
        </div>
      ) : (
        <div>
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--color-text)] mb-1.5">
              Reset your password
            </h1>
            <p className="text-xs sm:text-sm text-[var(--color-text-secondary)] leading-relaxed">
              Enter your email address and we&apos;ll send you a link to reset
              your credentials.
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
                htmlFor="forgot-email"
                className="block text-xs font-medium text-[var(--color-text)] mb-1.5"
              >
                Email address{" "}
                <span className="text-[var(--color-danger)]">*</span>
              </label>
              <div className="relative flex items-center">
                <Mail className="w-4 h-4 text-[var(--color-text-muted)] absolute left-3.5 pointer-events-none" />
                <input
                  id="forgot-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setErrorMsg("");
                  }}
                  placeholder="engineer@company.com"
                  className="w-full h-10 pl-10 pr-3.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-sm placeholder:text-[var(--color-text-muted)] transition-colors focus:outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
                />
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={status === "loading"}
              className="w-full font-semibold"
              icon={ArrowRight}
              iconPosition="right"
            >
              Send Reset Link
            </Button>
          </form>

          {/* Back to login */}
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => setMode("login")}
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
