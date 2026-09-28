import { useState } from "react";
import { motion } from "framer-motion";
import {
  KeyRound,
  Smartphone,
  Laptop,
  AlertTriangle,
  Eye,
  EyeOff,
  Lock,
} from "lucide-react";
import { useToast } from "../ToastContext";

export default function Security() {
  const { showToast } = useToast();
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [isSavingPw, setIsSavingPw] = useState(false);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);

  const [pwForm, setPwForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  // Calculate password strength
  const calculateStrength = (pw) => {
    if (!pw) return 0;
    let score = 0;
    if (pw.length >= 8) score += 25;
    if (/[A-Z]/.test(pw)) score += 25;
    if (/[0-9]/.test(pw)) score += 25;
    if (/[^A-Za-z0-9]/.test(pw)) score += 25;
    return score;
  };

  const strength = calculateStrength(pwForm.newPassword);
  const strengthColor =
    strength <= 25
      ? "var(--color-danger)"
      : strength <= 50
        ? "var(--color-warning)"
        : strength <= 75
          ? "var(--color-info)"
          : "var(--color-success)";
  const strengthLabel =
    strength <= 25
      ? "Weak"
      : strength <= 50
        ? "Fair"
        : strength <= 75
          ? "Good"
          : "Strong";

  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    if (!pwForm.currentPassword) {
      showToast({
        type: "warning",
        title: "Validation Error",
        message: "Please enter your current password.",
      });
      return;
    }
    if (pwForm.newPassword.length < 8) {
      showToast({
        type: "warning",
        title: "Weak Password",
        message: "New password must be at least 8 characters long.",
      });
      return;
    }
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      showToast({
        type: "error",
        title: "Passwords Do Not Match",
        message: "Confirm password does not match new password.",
      });
      return;
    }

    setIsSavingPw(true);
    // Simulate API call
    setTimeout(() => {
      setIsSavingPw(false);
      setPwForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      showToast({
        type: "success",
        title: "Password Updated",
        message: "Your password has been changed successfully.",
      });
    }, 800);
  };

  const handleToggle2FA = () => {
    const nextState = !twoFactorEnabled;
    setTwoFactorEnabled(nextState);
    showToast({
      type: nextState ? "success" : "info",
      title: nextState ? "2FA Enabled" : "2FA Disabled",
      message: nextState
        ? "Two-Factor Authentication is now active."
        : "Two-Factor Authentication has been turned off.",
    });
  };

  return (
    <div className="max-w-[920px] p-6 sm:p-8 font-sans text-[var(--color-text)]">
      {/* Header */}
      <div className="mb-7">
        <h1 className="text-lg font-bold text-[var(--color-text)] mb-1.5 flex items-center gap-2.5">
          <KeyRound size={20} className="text-[var(--color-primary)]" />
          Security & Authentication
        </h1>
        <p className="text-xs text-[var(--color-text-secondary)]">
          Manage your password, login sessions, and account protection settings.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        {/* Change Password Card */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-6">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/25 flex items-center justify-center text-[var(--color-primary)] shrink-0">
              <Lock size={15} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text)]">
                Change Password
              </h3>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Ensure your account is using a long, random password to stay
                secure.
              </p>
            </div>
          </div>

          <form onSubmit={handleUpdatePassword}>
            <div className="flex flex-col gap-4 max-w-md">
              {/* Current Password */}
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
                  Current Password
                </label>
                <div className="relative">
                  <input
                    type={showCurrentPw ? "text" : "password"}
                    value={pwForm.currentPassword}
                    onChange={(e) =>
                      setPwForm({ ...pwForm, currentPassword: e.target.value })
                    }
                    placeholder="Enter current password"
                    className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[var(--radius-md)] pl-3 pr-9 py-2 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] transition-all font-sans"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPw(!showCurrentPw)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors p-1 cursor-pointer"
                    title={showCurrentPw ? "Hide password" : "Show password"}
                    aria-label={
                      showCurrentPw ? "Hide password" : "Show password"
                    }
                  >
                    {showCurrentPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              {/* New Password */}
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
                  New Password
                </label>
                <div className="relative">
                  <input
                    type={showNewPw ? "text" : "password"}
                    value={pwForm.newPassword}
                    onChange={(e) =>
                      setPwForm({ ...pwForm, newPassword: e.target.value })
                    }
                    placeholder="At least 8 characters"
                    className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[var(--radius-md)] pl-3 pr-9 py-2 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] transition-all font-sans"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPw(!showNewPw)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors p-1 cursor-pointer"
                    title={showNewPw ? "Hide password" : "Show password"}
                    aria-label={showNewPw ? "Hide password" : "Show password"}
                  >
                    {showNewPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>

                {/* Strength Meter */}
                {pwForm.newPassword && (
                  <div className="mt-2">
                    <div className="h-1.5 w-full bg-[var(--color-surface-secondary)] rounded-full overflow-hidden">
                      <div
                        className="h-full transition-all duration-300 rounded-full"
                        style={{
                          width: `${strength}%`,
                          backgroundColor: strengthColor,
                        }}
                      />
                    </div>
                    <div
                      className="flex justify-between items-center text-[11px] mt-1 font-medium"
                      style={{ color: strengthColor }}
                    >
                      <span>Strength: {strengthLabel}</span>
                      <span className="text-[var(--color-text-muted)] font-normal">
                        8+ chars with letters & numbers
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Confirm Password */}
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
                  Confirm New Password
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPw ? "text" : "password"}
                    value={pwForm.confirmPassword}
                    onChange={(e) =>
                      setPwForm({ ...pwForm, confirmPassword: e.target.value })
                    }
                    placeholder="Repeat new password"
                    className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[var(--radius-md)] pl-3 pr-9 py-2 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] transition-all font-sans"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPw(!showConfirmPw)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors p-1 cursor-pointer"
                    title={showConfirmPw ? "Hide password" : "Show password"}
                    aria-label={
                      showConfirmPw ? "Hide password" : "Show password"
                    }
                  >
                    {showConfirmPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <div className="pt-2">
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  disabled={isSavingPw}
                  className="px-4 py-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-xs font-semibold hover:bg-[var(--color-primary-hover)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
                >
                  {isSavingPw ? "Updating..." : "Update Password"}
                </motion.button>
              </div>
            </div>
          </form>
        </div>

        {/* Two-Factor Authentication Card */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div
                className={`w-9 h-9 rounded-[var(--radius-md)] flex items-center justify-center shrink-0 border ${
                  twoFactorEnabled
                    ? "bg-[var(--color-success)]/10 border-[var(--color-success)]/25 text-[var(--color-success)]"
                    : "bg-[var(--color-surface-secondary)] border-[var(--color-border)] text-[var(--color-text-secondary)]"
                }`}
              >
                <Smartphone size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">
                    Two-Factor Authentication (2FA)
                  </h3>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                      twoFactorEnabled
                        ? "bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/25"
                        : "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border-[var(--color-border)]"
                    }`}
                  >
                    {twoFactorEnabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
                <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                  Require an authenticator code (Google Authenticator, Authy)
                  when logging in.
                </p>
              </div>
            </div>

            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleToggle2FA}
              className={`px-3.5 py-1.5 rounded-[var(--radius-md)] text-xs font-semibold cursor-pointer border transition-colors ${
                twoFactorEnabled
                  ? "bg-[var(--color-danger)]/10 border-[var(--color-danger)]/25 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/20"
                  : "bg-[var(--color-surface-secondary)] border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface)]"
              }`}
            >
              {twoFactorEnabled ? "Disable 2FA" : "Set Up 2FA"}
            </motion.button>
          </div>
        </div>

        {/* Active Sessions Card */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-6">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              Active Sessions
            </h3>
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
              Devices and browsers currently logged into your TestCovAI account.
            </p>
          </div>

          <div className="flex items-center justify-between p-3.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[var(--radius-md)]">
            <div className="flex items-center gap-3">
              <Laptop
                size={18}
                className="text-[var(--color-primary)] shrink-0"
              />
              <div>
                <div className="text-xs font-semibold text-[var(--color-text)] flex items-center gap-2">
                  Windows PC · Chrome Browser
                  <span className="text-[10px] text-[var(--color-success)] bg-[var(--color-success)]/10 px-1.5 py-0.5 rounded-[var(--radius-sm)] border border-[var(--color-success)]/20 font-medium">
                    Current Session
                  </span>
                </div>
                <div className="text-[11px] text-[var(--color-text-muted)] font-mono mt-0.5">
                  IP: 118.69.182.10 · Ho Chi Minh City, Vietnam
                </div>
              </div>
            </div>

            <div className="text-[11px] text-[var(--color-success)] flex items-center gap-1.5 font-medium">
              <span className="w-2 h-2 rounded-full bg-[var(--color-success)] shrink-0 inline-block" />
              Active now
            </div>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="bg-[var(--color-danger)]/5 border border-[var(--color-danger)]/20 rounded-[var(--radius-lg)] p-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-danger)] flex items-center gap-1.5">
                <AlertTriangle size={15} />
                Delete Account
              </h3>
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                Permanently delete your TestCovAI account, workspaces, and test
                suites.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                showToast({
                  type: "warning",
                  title: "Action Restricted",
                  message:
                    "Please contact support@testcovai.com to request account deletion.",
                });
              }}
              className="px-3.5 py-1.5 rounded-[var(--radius-md)] bg-transparent border border-[var(--color-danger)]/30 text-[var(--color-danger)] text-xs font-semibold hover:bg-[var(--color-danger)]/10 transition-colors cursor-pointer"
            >
              Delete Account
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
