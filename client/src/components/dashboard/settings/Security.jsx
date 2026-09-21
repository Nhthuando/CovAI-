import { useState } from "react";
import { motion } from "framer-motion";
import {
  Shield,
  KeyRound,
  Smartphone,
  Laptop,
  AlertTriangle,
  Eye,
  EyeOff,
  Check,
  CheckCircle2,
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
      ? "#ef4444"
      : strength <= 50
        ? "#f59e0b"
        : strength <= 75
          ? "#38bdf8"
          : "#22c55e";
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
    <div
      style={{
        maxWidth: "920px",
        padding: "32px 28px 64px",
        fontFamily: "var(--font-sans)",
        color: "#e6edf3",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: "28px" }}>
        <h1
          style={{
            fontSize: "22px",
            fontWeight: 700,
            color: "#e6edf3",
            marginBottom: "6px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <KeyRound size={22} style={{ color: "#a78bfa" }} />
          Security & Authentication
        </h1>
        <p style={{ color: "#8b949e", fontSize: "13px", margin: 0 }}>
          Manage your password, login sessions, and account protection settings.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        {/* Change Password Card */}
        <div
          style={{
            background: "rgba(255, 255, 255, 0.025)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "14px",
            padding: "24px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              marginBottom: "18px",
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "rgba(124, 58, 237, 0.12)",
                border: "1px solid rgba(124, 58, 237, 0.25)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Lock size={16} style={{ color: "#a78bfa" }} />
            </div>
            <div>
              <h3
                style={{
                  fontSize: "15px",
                  fontWeight: 600,
                  color: "#e6edf3",
                  margin: 0,
                }}
              >
                Change Password
              </h3>
              <p
                style={{
                  fontSize: "12px",
                  color: "#8b949e",
                  margin: "2px 0 0",
                }}
              >
                Ensure your account is using a long, random password to stay
                secure.
              </p>
            </div>
          </div>

          <form onSubmit={handleUpdatePassword}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "16px",
                maxWidth: "480px",
              }}
            >
              {/* Current Password */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 500,
                    color: "#8b949e",
                    marginBottom: "6px",
                  }}
                >
                  Current Password
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    type={showCurrentPw ? "text" : "password"}
                    value={pwForm.currentPassword}
                    onChange={(e) =>
                      setPwForm({ ...pwForm, currentPassword: e.target.value })
                    }
                    placeholder="Enter current password"
                    style={{
                      width: "100%",
                      padding: "9px 36px 9px 12px",
                      background: "rgba(0, 0, 0, 0.35)",
                      border: "1px solid rgba(255, 255, 255, 0.12)",
                      borderRadius: "8px",
                      color: "#e6edf3",
                      fontSize: "13px",
                      outline: "none",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPw(!showCurrentPw)}
                    style={{
                      position: "absolute",
                      right: "10px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "transparent",
                      border: "none",
                      color: "#6e7681",
                      cursor: "pointer",
                      padding: 2,
                    }}
                  >
                    {showCurrentPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              {/* New Password */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 500,
                    color: "#8b949e",
                    marginBottom: "6px",
                  }}
                >
                  New Password
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    type={showNewPw ? "text" : "password"}
                    value={pwForm.newPassword}
                    onChange={(e) =>
                      setPwForm({ ...pwForm, newPassword: e.target.value })
                    }
                    placeholder="At least 8 characters"
                    style={{
                      width: "100%",
                      padding: "9px 36px 9px 12px",
                      background: "rgba(0, 0, 0, 0.35)",
                      border: "1px solid rgba(255, 255, 255, 0.12)",
                      borderRadius: "8px",
                      color: "#e6edf3",
                      fontSize: "13px",
                      outline: "none",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPw(!showNewPw)}
                    style={{
                      position: "absolute",
                      right: "10px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "transparent",
                      border: "none",
                      color: "#6e7681",
                      cursor: "pointer",
                      padding: 2,
                    }}
                  >
                    {showNewPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>

                {/* Strength Meter */}
                {pwForm.newPassword && (
                  <div style={{ marginTop: "8px" }}>
                    <div
                      style={{
                        height: "4px",
                        width: "100%",
                        background: "rgba(255, 255, 255, 0.08)",
                        borderRadius: "2px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${strength}%`,
                          background: strengthColor,
                          transition: "width 0.3s ease, background 0.3s ease",
                        }}
                      />
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: "11px",
                        color: strengthColor,
                        marginTop: "4px",
                      }}
                    >
                      <span>Strength: {strengthLabel}</span>
                      <span style={{ color: "#6e7681" }}>
                        8+ chars with letters & numbers
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Confirm Password */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 500,
                    color: "#8b949e",
                    marginBottom: "6px",
                  }}
                >
                  Confirm New Password
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    type={showConfirmPw ? "text" : "password"}
                    value={pwForm.confirmPassword}
                    onChange={(e) =>
                      setPwForm({ ...pwForm, confirmPassword: e.target.value })
                    }
                    placeholder="Repeat new password"
                    style={{
                      width: "100%",
                      padding: "9px 36px 9px 12px",
                      background: "rgba(0, 0, 0, 0.35)",
                      border: "1px solid rgba(255, 255, 255, 0.12)",
                      borderRadius: "8px",
                      color: "#e6edf3",
                      fontSize: "13px",
                      outline: "none",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPw(!showConfirmPw)}
                    style={{
                      position: "absolute",
                      right: "10px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "transparent",
                      border: "none",
                      color: "#6e7681",
                      cursor: "pointer",
                      padding: 2,
                    }}
                  >
                    {showConfirmPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <div>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  disabled={isSavingPw}
                  style={{
                    padding: "9px 20px",
                    borderRadius: "8px",
                    background:
                      "linear-gradient(135deg, #7c3aed 0%, #6366f1 100%)",
                    border: "none",
                    color: "#fff",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: isSavingPw ? "not-allowed" : "pointer",
                    boxShadow: "0 2px 10px rgba(124, 58, 237, 0.35)",
                    opacity: isSavingPw ? 0.7 : 1,
                  }}
                >
                  {isSavingPw ? "Updating..." : "Update Password"}
                </motion.button>
              </div>
            </div>
          </form>
        </div>

        {/* Two-Factor Authentication Card */}
        <div
          style={{
            background: "rgba(255, 255, 255, 0.025)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "14px",
            padding: "24px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: twoFactorEnabled
                    ? "rgba(34, 197, 94, 0.15)"
                    : "rgba(255, 255, 255, 0.05)",
                  border: `1px solid ${twoFactorEnabled ? "rgba(34, 197, 94, 0.3)" : "rgba(255, 255, 255, 0.1)"}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Smartphone
                  size={18}
                  style={{ color: twoFactorEnabled ? "#4ade80" : "#8b949e" }}
                />
              </div>
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <h3
                    style={{
                      fontSize: "15px",
                      fontWeight: 600,
                      color: "#e6edf3",
                      margin: 0,
                    }}
                  >
                    Two-Factor Authentication (2FA)
                  </h3>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: "999px",
                      background: twoFactorEnabled
                        ? "rgba(34, 197, 94, 0.15)"
                        : "rgba(255, 255, 255, 0.06)",
                      color: twoFactorEnabled ? "#4ade80" : "#8b949e",
                      border: `1px solid ${twoFactorEnabled ? "rgba(34, 197, 94, 0.25)" : "rgba(255, 255, 255, 0.1)"}`,
                    }}
                  >
                    {twoFactorEnabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
                <p
                  style={{
                    fontSize: "12px",
                    color: "#8b949e",
                    margin: "4px 0 0",
                  }}
                >
                  Require an authenticator code (Google Authenticator, Authy)
                  when logging in.
                </p>
              </div>
            </div>

            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleToggle2FA}
              style={{
                padding: "8px 18px",
                borderRadius: "8px",
                background: twoFactorEnabled
                  ? "rgba(239, 68, 68, 0.1)"
                  : "rgba(124, 58, 237, 0.15)",
                border: `1px solid ${twoFactorEnabled ? "rgba(239, 68, 68, 0.3)" : "rgba(124, 58, 237, 0.3)"}`,
                color: twoFactorEnabled ? "#f87171" : "#c4b5fd",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {twoFactorEnabled ? "Disable 2FA" : "Set Up 2FA"}
            </motion.button>
          </div>
        </div>

        {/* Active Sessions Card */}
        <div
          style={{
            background: "rgba(255, 255, 255, 0.025)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "14px",
            padding: "24px",
          }}
        >
          <div style={{ marginBottom: "16px" }}>
            <h3
              style={{
                fontSize: "15px",
                fontWeight: 600,
                color: "#e6edf3",
                margin: 0,
              }}
            >
              Active Sessions
            </h3>
            <p
              style={{
                fontSize: "12px",
                color: "#8b949e",
                margin: "2px 0 0",
              }}
            >
              Devices and browsers currently logged into your TestCovAI account.
            </p>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 16px",
              background: "rgba(0, 0, 0, 0.3)",
              border: "1px solid rgba(255, 255, 255, 0.06)",
              borderRadius: "10px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <Laptop size={20} style={{ color: "#22d3ee" }} />
              <div>
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#e6edf3",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  Windows PC · Chrome Browser
                  <span
                    style={{
                      fontSize: "10px",
                      color: "#4ade80",
                      background: "rgba(34, 197, 94, 0.15)",
                      padding: "1px 6px",
                      borderRadius: "4px",
                    }}
                  >
                    Current Session
                  </span>
                </div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "#6e7681",
                    marginTop: "2px",
                  }}
                >
                  IP: 118.69.182.10 · Ho Chi Minh City, Vietnam
                </div>
              </div>
            </div>

            <div
              style={{
                fontSize: "11px",
                color: "#4ade80",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#4ade80",
                  boxShadow: "0 0 6px #4ade80",
                }}
              />
              Active now
            </div>
          </div>
        </div>

        {/* Danger Zone */}
        <div
          style={{
            background: "rgba(239, 68, 68, 0.03)",
            border: "1px solid rgba(239, 68, 68, 0.2)",
            borderRadius: "14px",
            padding: "24px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "16px",
            }}
          >
            <div>
              <h3
                style={{
                  fontSize: "15px",
                  fontWeight: 600,
                  color: "#f87171",
                  margin: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <AlertTriangle size={16} />
                Delete Account
              </h3>
              <p
                style={{
                  fontSize: "12px",
                  color: "#8b949e",
                  margin: "4px 0 0",
                }}
              >
                Permanently delete your TestCovAI account, workspaces, and test
                suites.
              </p>
            </div>

            <button
              onClick={() => {
                showToast({
                  type: "warning",
                  title: "Action Restricted",
                  message:
                    "Please contact support@testcovai.com to request account deletion.",
                });
              }}
              style={{
                padding: "8px 16px",
                borderRadius: "8px",
                background: "transparent",
                border: "1px solid rgba(239, 68, 68, 0.4)",
                color: "#f87171",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              Delete Account
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
