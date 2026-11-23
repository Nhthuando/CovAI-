import { useState } from "react";
import {
  Mail,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { forgotPasswordApi } from "../../services/auth.service";
import { EMAIL_REGEX, AUTH_MESSAGES } from "../../../../shared/authValidation.js";

export default function ForgotPasswordForm({ setMode, initialEmail = "" }) {
  const [email, setEmail] = useState(initialEmail);
  const [status, setStatus] = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setErrorMsg(AUTH_MESSAGES.EMAIL_REQUIRED);
      setStatus("error");
      return;
    }
    if (!EMAIL_REGEX.test(trimmed)) {
      setErrorMsg(AUTH_MESSAGES.EMAIL_INVALID);
      setStatus("error");
      return;
    }

    setErrorMsg("");
    setStatus("loading");

    try {
      await forgotPasswordApi(trimmed.toLowerCase());
      setStatus("success");
    } catch (error) {
      setErrorMsg(error.message || "Failed to send reset link.");
      setStatus("error");
    }
  };

  return (
    <div className="w-full">
      {status === "success" ? (
        <div className="p-6 rounded-xl bg-[var(--lp-inset)] border border-[var(--lp-line)] text-center">
          <CheckCircle2 className="w-9 h-9 text-[var(--lp-signal)] mx-auto mb-3" />
          <h2 className="lp-display text-lg font-bold text-[var(--lp-ink)] mb-2">
            Reset link dispatched
          </h2>
          <p className="text-xs text-[var(--lp-ink-secondary)] leading-relaxed mb-6">
            If an account exists for{" "}
            <span className="font-semibold text-[var(--lp-ink)] lp-mono">{email}</span>,
            you will receive password reset instructions shortly.
          </p>
          <button
            type="button"
            onClick={() => setMode("login")}
            className="w-full h-10 rounded-lg lp-btn-secondary text-xs font-medium inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to sign in</span>
          </button>
        </div>
      ) : (
        <div>
          <div className="mb-6">
            <h1 className="lp-display text-2xl font-bold tracking-tight text-[var(--lp-ink)] mb-1.5">
              Reset your password
            </h1>
            <p className="text-xs sm:text-sm text-[var(--lp-ink-secondary)] leading-relaxed">
              Enter your email address and we will send a link to reset your
              password.
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
                htmlFor="forgot-email"
                className="block text-xs font-medium text-[var(--lp-ink-secondary)] mb-1.5"
              >
                Email address <span className="text-[var(--lp-fault)]">*</span>
              </label>
              <div className="relative flex items-center">
                <Mail className="w-4 h-4 text-[var(--lp-ink-muted)] absolute left-3.5 pointer-events-none" />
                <input
                  id="forgot-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setErrorMsg("");
                  }}
                  placeholder="engineer@company.com"
                  className="w-full h-10 pl-10 pr-3.5 rounded-lg border border-[var(--lp-line-strong)] bg-[var(--lp-inset)] text-[var(--lp-ink)] text-sm placeholder:text-[var(--lp-ink-muted)] transition-colors focus:outline-none focus:border-[var(--lp-signal)]"
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
                  <span>Sending link...</span>
                </>
              ) : (
                <span>Send reset link</span>
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => setMode("login")}
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
