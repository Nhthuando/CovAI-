import { motion } from "framer-motion";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  X,
} from "lucide-react";

/* ── Toast type config ─────────────────────────────────────── */
const TOAST_CONFIG = {
  success: {
    icon: CheckCircle2,
    accent: "#3fb950",
    bg: "rgba(63, 185, 80, 0.08)",
    border: "rgba(63, 185, 80, 0.25)",
    glow: "0 0 24px rgba(63, 185, 80, 0.15)",
    iconBg: "rgba(63, 185, 80, 0.15)",
  },
  error: {
    icon: XCircle,
    accent: "#f85149",
    bg: "rgba(248, 81, 73, 0.08)",
    border: "rgba(248, 81, 73, 0.25)",
    glow: "0 0 24px rgba(248, 81, 73, 0.15)",
    iconBg: "rgba(248, 81, 73, 0.15)",
  },
  warning: {
    icon: AlertTriangle,
    accent: "#d29922",
    bg: "rgba(210, 153, 34, 0.08)",
    border: "rgba(210, 153, 34, 0.25)",
    glow: "0 0 24px rgba(210, 153, 34, 0.15)",
    iconBg: "rgba(210, 153, 34, 0.15)",
  },
  info: {
    icon: Info,
    accent: "#a78bfa",
    bg: "rgba(124, 58, 237, 0.06)",
    border: "rgba(124, 58, 237, 0.25)",
    glow: "0 0 24px rgba(124, 58, 237, 0.12)",
    iconBg: "rgba(124, 58, 237, 0.15)",
  },
};

export default function Toast({ toast, onClose }) {
  const cfg = TOAST_CONFIG[toast.type] || TOAST_CONFIG.info;
  const Icon = cfg.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 80, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 80, scale: 0.85 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      style={{
        pointerEvents: "auto",
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
        padding: "16px 20px",
        borderRadius: 14,
        background: "#161b22",
        border: `1px solid ${cfg.border}`,
        boxShadow: `${cfg.glow}, 0 8px 32px rgba(0, 0, 0, 0.5)`,
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        maxWidth: 420,
        width: "100%",
        cursor: "default",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Accent gradient bar (top) */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: `linear-gradient(90deg, ${cfg.accent}, transparent 80%)`,
          opacity: 0.8,
        }}
      />

      {/* Icon */}
      <div
        style={{
          flexShrink: 0,
          width: 32,
          height: 32,
          borderRadius: 10,
          background: cfg.iconBg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginTop: 1,
        }}
      >
        <Icon size={16} style={{ color: cfg.accent }} strokeWidth={2.5} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {toast.title && (
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#e6edf3",
              fontFamily: "var(--font-sans)",
              lineHeight: 1.3,
              marginBottom: 3,
            }}
          >
            {toast.title}
          </div>
        )}
        <div
          style={{
            fontSize: 12.5,
            color: "#8b949e",
            fontFamily: "var(--font-sans)",
            lineHeight: 1.5,
            wordBreak: "break-word",
          }}
        >
          {toast.message}
        </div>
      </div>

      {/* Close button */}
      <motion.button
        whileHover={{ scale: 1.15 }}
        whileTap={{ scale: 0.9 }}
        onClick={onClose}
        style={{
          flexShrink: 0,
          background: "rgba(255, 255, 255, 0.05)",
          border: "none",
          borderRadius: 6,
          width: 22,
          height: 22,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#484f58",
          cursor: "pointer",
          marginTop: 1,
          transition: "color 0.15s ease",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "#8b949e")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "#484f58")}
      >
        <X size={12} />
      </motion.button>

      {/* Auto-dismiss progress bar */}
      <motion.div
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: 4.5, ease: "linear" }}
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 2,
          background: cfg.accent,
          opacity: 0.4,
          transformOrigin: "left center",
        }}
      />
    </motion.div>
  );
}
