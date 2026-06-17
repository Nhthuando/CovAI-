import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, Eye, EyeOff, ArrowLeft, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { resetPasswordApi } from "../../services/auth.service";

/* ── Container animation ─────────────────────────────────────── */
const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
};
const shakeVariants = {
  shake: { x: [0, -8, 8, -6, 6, -4, 4, 0], transition: { duration: 0.45 } },
};

export default function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [focusedInput, setFocusedInput] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | loading | success | error
  const [errorMsg, setErrorMsg] = useState("");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!token) {
      setErrorMsg("Invalid or missing reset token.");
      setStatus("error");
      setTimeout(() => setStatus("idle"), 1500);
      return;
    }
    if (!password || password.length < 6) {
      setErrorMsg("Password must be at least 6 characters.");
      setStatus("error");
      setTimeout(() => setStatus("idle"), 600);
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg("Passwords do not match.");
      setStatus("error");
      setTimeout(() => setStatus("idle"), 600);
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
      setTimeout(() => setStatus("idle"), 600);
    }
  };

  return (
    <div style={{ width: "100%", maxWidth: "480px", margin: "0 auto", padding: "0 2rem", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <AnimatePresence mode="wait">
        {status === "success" ? (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "1.5rem",
              padding: "3.5rem 2.5rem",
              borderRadius: "16px",
              background: "rgba(74,222,128,0.06)",
              border: "1px solid rgba(74,222,128,0.25)",
              textAlign: "center",
              marginBottom: "1.5rem",
            }}
          >
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 200 }}>
              <CheckCircle2 size={56} color="#4ade80" />
            </motion.div>
            <div>
              <p style={{ fontWeight: "700", color: "#f0f6fc", marginBottom: "0.75rem", fontSize: "1.5rem", letterSpacing: "-0.02em" }}>
                Password Updated!
              </p>
              <p style={{ color: "#8b949e", fontSize: "1.05rem", lineHeight: "1.6" }}>
                Your password has been successfully reset. You can now sign in with your new password.
              </p>
            </div>
            <button
              onClick={() => navigate("/login")}
              style={{
                marginTop: "1.5rem",
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.15)",
                color: "#f0f6fc",
                padding: "0.85rem 1.75rem",
                borderRadius: "10px",
                fontSize: "1rem",
                fontWeight: "500",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              Go to Sign In
            </button>
          </motion.div>
        ) : (
          <motion.div key="form" variants={containerVariants} initial="hidden" animate="visible" style={{ width: "100%" }}>
            
            <motion.div variants={itemVariants} style={{ marginBottom: "2.5rem" }}>
              <h1 style={{
                fontSize: "2.4rem",
                fontWeight: "800",
                color: "#f0f6fc",
                letterSpacing: "-0.03em",
                marginBottom: "0.75rem",
              }}>
                Reset Password
              </h1>
              <p style={{ color: "#8b949e", fontSize: "1.1rem", lineHeight: "1.65" }}>
                Please enter your new password below.
              </p>
            </motion.div>

            <AnimatePresence>
              {errorMsg && (
                <motion.div
                  initial={{ opacity: 0, y: -8, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: "auto" }}
                  exit={{ opacity: 0, y: -8, height: 0 }}
                  style={{
                    display: "flex", alignItems: "center", gap: "10px",
                    padding: "1rem 1.25rem", borderRadius: "12px",
                    background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
                    marginBottom: "2rem", overflow: "hidden",
                  }}
                >
                  <AlertCircle size={18} color="#f87171" style={{ flexShrink: 0 }} />
                  <span style={{ color: "#f87171", fontSize: "0.95rem", lineHeight: "1.5" }}>{errorMsg}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.form variants={shakeVariants} animate={status === "error" ? "shake" : ""} onSubmit={handleSubmit} noValidate>
              
              {/* New Password */}
              <motion.div variants={itemVariants} style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "1.2rem" }}>
                <label htmlFor="new-password" style={{ fontSize: "0.85rem", fontWeight: "600", color: "#8b949e", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  New Password
                </label>
                <div style={{
                  display: "flex", alignItems: "center", borderRadius: "12px",
                  background: "rgba(255,255,255,0.03)",
                  border: `1px solid ${focusedInput === "new-password" ? "rgba(124,58,237,0.5)" : "rgba(255,255,255,0.1)"}`,
                  boxShadow: focusedInput === "new-password" ? "0 0 0 4px rgba(124,58,237,0.15)" : "none",
                  transition: "all 0.2s ease"
                }}>
                  <input
                    id="new-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setErrorMsg(""); }}
                    onFocus={() => setFocusedInput("new-password")}
                    onBlur={() => setFocusedInput(null)}
                    placeholder="••••••••"
                    style={{
                      flex: 1, background: "transparent", border: "none", outline: "none",
                      padding: "1.1rem 1.2rem", color: "#f0f6fc", fontSize: "1.05rem",
                      fontFamily: "Inter, sans-serif"
                    }}
                  />
                  <div 
                    onClick={() => setShowPassword(!showPassword)}
                    style={{ padding: "0 16px", color: "#6e7681", cursor: "pointer", display: "flex" }}
                  >
                    {showPassword ? <Eye size={20} /> : <EyeOff size={20} />}
                  </div>
                </div>
              </motion.div>

              {/* Confirm Password */}
              <motion.div variants={itemVariants} style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "2.5rem" }}>
                <label htmlFor="confirm-password" style={{ fontSize: "0.85rem", fontWeight: "600", color: "#8b949e", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  Confirm New Password
                </label>
                <div style={{
                  display: "flex", alignItems: "center", borderRadius: "12px",
                  background: "rgba(255,255,255,0.03)",
                  border: `1px solid ${focusedInput === "confirm-password" ? "rgba(124,58,237,0.5)" : "rgba(255,255,255,0.1)"}`,
                  boxShadow: focusedInput === "confirm-password" ? "0 0 0 4px rgba(124,58,237,0.15)" : "none",
                  transition: "all 0.2s ease"
                }}>
                  <input
                    id="confirm-password"
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); setErrorMsg(""); }}
                    onFocus={() => setFocusedInput("confirm-password")}
                    onBlur={() => setFocusedInput(null)}
                    placeholder="••••••••"
                    style={{
                      flex: 1, background: "transparent", border: "none", outline: "none",
                      padding: "1.1rem 1.2rem", color: "#f0f6fc", fontSize: "1.05rem",
                      fontFamily: "Inter, sans-serif"
                    }}
                  />
                </div>
              </motion.div>

              <motion.div variants={itemVariants}>
                <motion.button
                  type="submit"
                  whileHover={{ scale: 1.02, boxShadow: "0 0 24px rgba(124,58,237,0.3)" }}
                  whileTap={{ scale: 0.98 }}
                  disabled={status === "loading"}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.6rem",
                    padding: "1.1rem", borderRadius: "12px",
                    background: "rgba(255,255,255,0.03)", // Match image button color
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "white", fontSize: "1.1rem", fontWeight: "700",
                    cursor: status === "loading" ? "not-allowed" : "pointer",
                    fontFamily: "Inter, sans-serif", transition: "all 0.2s ease"
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(124,58,237,0.2)"; e.currentTarget.style.borderColor = "rgba(124,58,237,0.5)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; }}
                >
                  {status === "loading" ? (
                    <>
                      <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}>
                        <Loader2 size={20} />
                      </motion.div>
                      Updating...
                    </>
                  ) : (
                    <>
                      Update Password <Lock size={18} />
                    </>
                  )}
                </motion.button>
              </motion.div>
            </motion.form>

            <motion.div variants={itemVariants} style={{ marginTop: "2.5rem", textAlign: "center" }}>
              <button
                onClick={() => navigate("/login")}
                style={{
                  display: "inline-flex", alignItems: "center", gap: "0.5rem",
                  background: "none", border: "none", color: "#8b949e",
                  fontSize: "1rem", fontWeight: "500", cursor: "pointer",
                  transition: "color 0.2s ease", padding: 0
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#f0f6fc")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#8b949e")}
              >
                <ArrowLeft size={18} /> Back to Sign In
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
