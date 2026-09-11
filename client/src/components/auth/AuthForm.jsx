import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  User,
  ArrowRight,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { loginApi, registerApi } from "../../services/auth.service";

function GithubIcon({ size = 17 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
};

const shakeVariants = {
  shake: {
    x: [0, -8, 8, -6, 6, -4, 4, 0],
    transition: { duration: 0.45 },
  },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function InputField({
  id,
  label,
  type = "text",
  placeholder,
  icon: Icon,
  value,
  onChange,
  error,
  rightSlot,
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <label
        htmlFor={id}
        style={{
          fontSize: "0.78rem",
          fontWeight: "600",
          color: "#8b949e",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </label>
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          borderRadius: "10px",
          border: `1px solid ${error ? "rgba(239,68,68,0.5)" : focused ? "rgba(124,58,237,0.6)" : "rgba(255,255,255,0.08)"}`,
          background: "rgba(255,255,255,0.03)",
          transition: "border-color 0.2s, box-shadow 0.2s",
          boxShadow: focused
            ? error
              ? "0 0 0 3px rgba(239,68,68,0.12)"
              : "0 0 0 3px rgba(124,58,237,0.12)"
            : "none",
        }}
      >
        <div
          style={{
            padding: "0 0 0 14px",
            display: "flex",
            alignItems: "center",
            color: focused ? "#7C3AED" : "#484f58",
            transition: "color 0.2s",
          }}
        >
          <Icon size={15} />
        </div>
        <input
          id={id}
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoComplete={
            id === "auth-password" || id === "auth-confirm"
              ? "current-password"
              : id
          }
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            padding: "0.75rem 0.75rem",
            color: "#f0f6fc",
            fontSize: "0.875rem",
            fontFamily: "Inter, sans-serif",
          }}
        />
        {rightSlot && <div style={{ padding: "0 12px 0 0" }}>{rightSlot}</div>}
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -4, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -4, height: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: "hidden" }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                fontSize: "0.75rem",
                color: "#f87171",
                lineHeight: "1.4",
              }}
            >
              <AlertCircle size={12} style={{ flexShrink: 0 }} />
              {error}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function EyeToggle({ show, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        color: "#484f58",
        display: "flex",
        alignItems: "center",
        padding: 0,
        transition: "color 0.2s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "#8b949e")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "#484f58")}
    >
      {show ? <EyeOff size={15} /> : <Eye size={15} />}
    </button>
  );
}

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
  const [status, setStatus] = useState("idle");
  const [serverMessage, setServerMessage] = useState("");

  const update = (field) => (e) => {
    setFormData((d) => ({ ...d, [field]: e.target.value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: "" }));
    setServerMessage("");
  };

  function validate() {
    const errs = {};
    if (!isLogin && !formData.name.trim()) errs.name = "Vui lòng nhập họ tên";
    if (!EMAIL_RE.test(formData.email))
      errs.email = "Email không hợp lệ, vui lòng kiểm tra lại";
    if (formData.password.length < 8)
      errs.password = "Mật khẩu phải có ít nhất 8 ký tự";
    if (!isLogin && formData.confirm !== formData.password)
      errs.confirm = "Mật khẩu không khớp";
    return errs;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setServerMessage("");

    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      setStatus("error");
      setTimeout(() => setStatus("idle"), 600);
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
      }, 1500);
    } catch (err) {
      if (err.type === "field") {
        setErrors(err.errors);
        setStatus("error");
        setTimeout(() => setStatus("idle"), 600);
      } else {
        setServerMessage(err.message || "Có lỗi xảy ra, vui lòng thử lại");
        setStatus("error");
        setTimeout(() => setStatus("idle"), 600);
      }
    }
  }

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "400px",
        margin: "0 auto",
        padding: "0 1.5rem",
      }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={mode + "-heading"}
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.3 }}
          style={{ marginBottom: "2rem" }}
        >
          <h1
            style={{
              fontSize: "1.75rem",
              fontWeight: "800",
              color: "#f0f6fc",
              letterSpacing: "-0.03em",
              marginBottom: "0.4rem",
            }}
          >
            {isLogin ? "Welcome back" : "Create account"}
          </h1>
          <p
            style={{
              color: "#8b949e",
              fontSize: "0.875rem",
              lineHeight: "1.6",
            }}
          >
            {isLogin
              ? "Sign in to access your AI test coverage dashboard."
              : "Start automating test coverage in minutes — free forever."}
          </p>
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {status === "success" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "1rem",
              padding: "2.5rem",
              borderRadius: "14px",
              background: "rgba(74,222,128,0.06)",
              border: "1px solid rgba(74,222,128,0.25)",
              textAlign: "center",
              marginBottom: "1.5rem",
            }}
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200 }}
            >
              <CheckCircle2 size={44} color="#4ade80" />
            </motion.div>
            <div>
              <p
                style={{
                  fontWeight: "700",
                  color: "#f0f6fc",
                  marginBottom: "0.25rem",
                }}
              >
                {isLogin
                  ? "Đăng nhập thành công!"
                  : "Tạo tài khoản thành công!"}
              </p>
              <p style={{ color: "#8b949e", fontSize: "0.8rem" }}>
                Đang chuyển hướng…
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {status !== "success" && (
        <>
          <motion.button
            id="auth-github-btn"
            type="button"
            onClick={() => {
              const clientId =
                import.meta.env.VITE_GITHUB_CLIENT_ID || "Ov23liQyAORXbj6NeqAB";
              const redirectUri = `${window.location.origin}/auth/github/callback`;
              window.location.href = `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=user:email repo&redirect_uri=${redirectUri}`;
            }}
            whileHover={{ scale: 1.02, background: "rgba(255,255,255,0.08)" }}
            whileTap={{ scale: 0.98 }}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.625rem",
              padding: "0.75rem",
              borderRadius: "10px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#f0f6fc",
              fontSize: "0.9rem",
              fontWeight: "600",
              cursor: "pointer",
              fontFamily: "Inter, sans-serif",
              marginBottom: "1.5rem",
              transition: "background 0.2s",
            }}
          >
            <GithubIcon size={17} />
            Continue with GitHub
          </motion.button>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              marginBottom: "1.5rem",
            }}
          >
            <div
              style={{
                flex: 1,
                height: "1px",
                background: "rgba(255,255,255,0.07)",
              }}
            />
            <span
              style={{
                color: "#484f58",
                fontSize: "0.75rem",
                fontWeight: "600",
                letterSpacing: "0.08em",
              }}
            >
              OR
            </span>
            <div
              style={{
                flex: 1,
                height: "1px",
                background: "rgba(255,255,255,0.07)",
              }}
            />
          </div>

          <AnimatePresence>
            {serverMessage && (
              <motion.div
                initial={{ opacity: 0, y: -8, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, y: -8, height: 0 }}
                transition={{ duration: 0.25 }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "0.75rem 1rem",
                  borderRadius: "10px",
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.25)",
                  marginBottom: "1rem",
                  overflow: "hidden",
                }}
              >
                <AlertCircle
                  size={15}
                  color="#f87171"
                  style={{ flexShrink: 0 }}
                />
                <span
                  style={{
                    color: "#f87171",
                    fontSize: "0.85rem",
                    lineHeight: "1.4",
                  }}
                >
                  {serverMessage}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.form
            key={mode + "-form"}
            id={`auth-${mode}-form`}
            variants={shakeVariants}
            animate={status === "error" ? "shake" : ""}
            onSubmit={handleSubmit}
            noValidate
          >
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
            >
              <AnimatePresence>
                {!isLogin && (
                  <motion.div
                    key="name-field"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                    style={{ overflow: "hidden" }}
                  >
                    <motion.div variants={itemVariants}>
                      <InputField
                        id="auth-name"
                        label="FULL NAME"
                        type="text"
                        placeholder="Jane Doe"
                        icon={User}
                        value={formData.name}
                        onChange={update("name")}
                        error={errors.name}
                      />
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              <motion.div variants={itemVariants}>
                <InputField
                  id="auth-email"
                  label="EMAIL"
                  type="text"
                  placeholder="you@company.com"
                  icon={Mail}
                  value={formData.email}
                  onChange={update("email")}
                  error={errors.email}
                />
              </motion.div>

              <motion.div variants={itemVariants}>
                <InputField
                  id="auth-password"
                  label="PASSWORD"
                  type={showPass ? "text" : "password"}
                  placeholder={
                    isLogin ? "Enter your password" : "Min. 8 characters"
                  }
                  icon={Lock}
                  value={formData.password}
                  onChange={update("password")}
                  error={errors.password}
                  rightSlot={
                    <EyeToggle
                      show={showPass}
                      onToggle={() => setShowPass((v) => !v)}
                    />
                  }
                />
              </motion.div>

              <AnimatePresence>
                {!isLogin && (
                  <motion.div
                    key="confirm-field"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                    style={{ overflow: "hidden" }}
                  >
                    <motion.div variants={itemVariants}>
                      <InputField
                        id="auth-confirm"
                        label="CONFIRM PASSWORD"
                        type={showConfirm ? "text" : "password"}
                        placeholder="Re-enter password"
                        icon={Lock}
                        value={formData.confirm}
                        onChange={update("confirm")}
                        error={errors.confirm}
                        rightSlot={
                          <EyeToggle
                            show={showConfirm}
                            onToggle={() => setShowConfirm((v) => !v)}
                          />
                        }
                      />
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              {isLogin && (
                <motion.div
                  variants={itemVariants}
                  style={{ textAlign: "right", marginTop: "-4px" }}
                >
                  <a
                    href="#forgot"
                    onClick={(e) => {
                      e.preventDefault();
                      setMode("forgot_password");
                    }}
                    style={{
                      fontSize: "0.78rem",
                      color: "#7C3AED",
                      textDecoration: "none",
                      fontWeight: "500",
                    }}
                    onMouseEnter={(e) => (e.target.style.color = "#9d5cf5")}
                    onMouseLeave={(e) => (e.target.style.color = "#7C3AED")}
                  >
                    Forgot password?
                  </a>
                </motion.div>
              )}

              <motion.div
                variants={itemVariants}
                style={{ marginTop: "0.5rem" }}
              >
                <motion.button
                  id="auth-submit-btn"
                  type="submit"
                  whileHover={{
                    scale: 1.02,
                    boxShadow: "0 0 32px rgba(124,58,237,0.5)",
                  }}
                  whileTap={{ scale: 0.98 }}
                  disabled={status === "loading"}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "0.5rem",
                    padding: "0.825rem",
                    borderRadius: "10px",
                    background:
                      status === "loading"
                        ? "rgba(124,58,237,0.5)"
                        : "linear-gradient(135deg, #7C3AED 0%, #9d5cf5 100%)",
                    border: "none",
                    color: "white",
                    fontSize: "0.925rem",
                    fontWeight: "700",
                    cursor: status === "loading" ? "not-allowed" : "pointer",
                    fontFamily: "Inter, sans-serif",
                    boxShadow: "0 0 20px rgba(124,58,237,0.3)",
                    transition: "background 0.2s",
                    letterSpacing: "0.01em",
                  }}
                >
                  {status === "loading" ? (
                    <>
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{
                          duration: 0.8,
                          repeat: Infinity,
                          ease: "linear",
                        }}
                      >
                        <Loader2 size={16} />
                      </motion.div>
                      {isLogin ? "Đang đăng nhập…" : "Đang tạo tài khoản…"}
                    </>
                  ) : (
                    <>
                      {isLogin ? "Sign in" : "Create account"}
                      <ArrowRight size={16} />
                    </>
                  )}
                </motion.button>
              </motion.div>

              {!isLogin && (
                <motion.p
                  variants={itemVariants}
                  style={{
                    textAlign: "center",
                    fontSize: "0.72rem",
                    color: "#484f58",
                    lineHeight: "1.6",
                  }}
                >
                  By creating an account you agree to our{" "}
                  <a
                    href="#"
                    style={{ color: "#7C3AED", textDecoration: "none" }}
                  >
                    Terms
                  </a>{" "}
                  and{" "}
                  <a
                    href="#"
                    style={{ color: "#7C3AED", textDecoration: "none" }}
                  >
                    Privacy Policy
                  </a>
                  .
                </motion.p>
              )}
            </motion.div>
          </motion.form>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            style={{
              marginTop: "1.75rem",
              textAlign: "center",
              fontSize: "0.85rem",
              color: "#8b949e",
            }}
          >
            {isLogin ? (
              <>
                Don't have an account?{" "}
                <button
                  id="auth-toggle-to-register"
                  onClick={onToggleMode}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#7C3AED",
                    fontWeight: "700",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                    fontFamily: "Inter, sans-serif",
                    padding: 0,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.color = "#9d5cf5")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.color = "#7C3AED")
                  }
                >
                  Create account →
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  id="auth-toggle-to-login"
                  onClick={onToggleMode}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#7C3AED",
                    fontWeight: "700",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                    fontFamily: "Inter, sans-serif",
                    padding: 0,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.color = "#9d5cf5")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.color = "#7C3AED")
                  }
                >
                  Sign in →
                </button>
              </>
            )}
          </motion.div>
        </>
      )}
    </div>
  );
}
